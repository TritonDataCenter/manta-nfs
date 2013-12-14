// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var path = require('path');

var nfs = require('nfs');
var vasync = require('vasync');

var common = require('./common');
var crc32 = require('sse4_crc32');


///--- Helpers

function rand() {
    return (Math.floor((Math.random() * Math.pow(2, 31)) + 1));
}



///-- API

function readdirplus(call, reply, next) {
    var log = call.log;
    log.debug('readdirplus(%s): entered', call._filename);

    var barrier = vasync.barrier();
    var error = null;

    barrier.once('drain', function () {
        if (error) {
            nfs.handle_error(error, call, reply, next);
        } else {
            call.fs.stat(call._filename, function (err, stats) {
                if (err) {
                    log.warn(err, 'readdirplus(%s): dir stat failed',
                         call._filename);
                    reply.error(nfs.NFS3ERR_SERVERFAULT);
                    next(false);
                } else {
                    log.debug('readdirplus(%s): done', call._filename);
                    reply.setDirAttributes(stats);
                    reply.send();
                    next();
                }
            });
        }
    });

    barrier.start('readdir: ' + call._filename);
    call.fs.readdir(call._filename, function (err1, files) {
        barrier.done('readdir: ' + call._filename);
        if (err1) {
            log.warn(err1, 'readdirplus(%s): failed', call._filename);
            error = error || (err1.code === 'ENOTDIR' ?
                        nfs.NFS3ERR_NOTDIR :
                        nfs.NFS3ERR_IO);
            return;
        }

        reply.eof = (files.length < call.count);

        // XXX is cookie handling ok?
        var cook = 1;
        files.forEach(function (f) {
            var p = path.join(call._filename, f);
            barrier.start('file: ' + p);
            call.fs.lookup(p, function (err2, fhandle) {
                if (err2) {
                    log.warn(err2, 'readdirplus_lookup(%s): failed', p);
                    error = error || err2;
                    barrier.done('file: ' + p);
                } else {
                    call.fs.stat(p, function (err3, stats) {
                        barrier.done('file: ' + p);
                        if (err3) {
                            log.warn(err3, 'readdirplus(%s): stat failed', p);
                            error = error || err3;
                        } else {
                            reply.addEntry({
                                fileid: crc32.calculate(p),
                                name: f,
                                cookie: cook++,
                                name_attributes: nfs.fattr3.create(stats),
                                name_handle: fhandle
                            });
                        }

                    });
                }
            });
        });
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        common.fhandle_to_filename,
        readdirplus
    ]);
};
