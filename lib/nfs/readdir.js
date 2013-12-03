// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var path = require('path');

var nfs = require('nfs');

var fsCache = require('../fs-cache');

var common = require('./common');
var murmur = require('./murmur3');



///--- Helpers

function rand() {
    return (Math.floor((Math.random() * Math.pow(2, 31)) + 1));
}



///-- API

function readdir(call, reply, next) {
    var cache = call.cache;
    var log = call.log;
    log.debug('readdir(%s): entered', call.dir);

    cache.readdir(call._filename, function (err, files) {
        if (err) {
            log.warn(err, 'readdir(%s): failed', call.dir);
            reply.error(err.code === 'ENOTDIR' ?
                        nfs.NFS3ERR_NOTDIR :
                        nfs.NFS3ERR_IO);
            next(false);
            return;
        }

        reply.eof = (files.length < call.count);

        // XXX fix cookie handling
        var cook = 1;
        files.forEach(function (f) {
            reply.addEntry({
                fileid: murmur(path.join(call._filename, f), 1234),
                name: f,
                cookie: cook++
            });
        });

        cache.stat(call._filename, function (err2, stats) {
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
        common.get_cache_by_fhandle,
        common.fhandle_to_filename,
        common.ensure_file_in_cache,
        readdir
    ]);
};
