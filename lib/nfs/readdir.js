// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var path = require('path');

var nfs = require('nfs');

var common = require('./common');
var crc32 = require('sse4_crc32');



///--- Helpers

function rand() {
    return (Math.floor((Math.random() * Math.pow(2, 31)) + 1));
}



///-- API

function readdir(call, reply, next) {
    var log = call.log;
    log.debug('readdir(%s): entered', call._filename);

    call.fs.readdir(call._filename, function (err, files) {
        if (err) {
            log.warn(err, 'readdir(%s): failed', call.dir);
            reply.error(err.code === 'ENOTDIR' ?
                        nfs.NFS3ERR_NOTDIR :
                        nfs.NFS3ERR_IO);
            next(false);
            return;
        }

        reply.eof = (files.length < call.count);

        // XXX is cookie handling ok?
        var cook = 1;
        files.forEach(function (f) {
            reply.addEntry({
                fileid: crc32.calculate(path.join(call._filename, f)),
                name: f,
                cookie: cook++
            });
        });

        call.fs.stat(call._filename, function (err2, stats) {
            if (err2) {
                log.warn(err2, 'readdir(%s): stat failed', call.dir);
                reply.error(nfs.NFS3ERR_SERVERFAULT);
                next(false);
            } else {
                reply.setDirAttributes(stats);
                reply.send();
                next();
            }
        });
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        common.fhandle_to_filename,
        readdir
    ]);
};
