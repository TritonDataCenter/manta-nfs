// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var assert = require('assert-plus');
var nfs = require('nfs');
var once = require('once');



///-- API

function fhandle_to_filename(call, reply, next) {
    var fhandle = call.fhandle || call.object;
    var log = call.log;

    log.debug('fhandle_to_filename(%s): entered', fhandle);
    assert.string(fhandle, 'call.fhandle');


    call.fs.fhandle(fhandle, function (err, name) {
        if (err) {
            log.warn(err, 'fhandle_to_filename(%s): failed', fhandle);
            reply.error(nfs.NFS3ERR_BADHANDLE);
            next(false);
        } else {
            call._filename = name;
            log.debug('fhandle_to_filename(%s): done: %s', fhandle, name);
            next();
        }
    });
}

function handle_error(err, req, res, next) {
    switch (err.code) {
    case 'EACCESS':
        res.error(nfs.NFS3ERR_ACCES);
        break;

    case 'ENOENT':
        res.error(nfs.NFS3ERR_NOENT);
        break;

    case 'ENOTDIR':
        res.error(nfs.NFS3ERR_NOTDIR);
        break;

    case 'ENOTEMPTY':
        res.error(nfs.NFS3ERR_NOTEMPTY);
        break;

    default:
        res.error(nfs.NFS3ERR_SERVERFAULT);
        break;
    }
    next(false);
}


function open(call, reply, next) {
    var log = call.log;

    log.debug('open(%s): entered', call.object);

    if (call.fd_cache.has(call.object)) {
        call.stats = call.fd_cache.get(call.object);
        next();
        return;
    }

    call.fs.stat(call._filename, function (st_err, stats) {
        if (st_err) {
            log.warn(st_err, 'open: fsCache.stat failed');
            reply.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        call.fs.open(call._filename, 'r+', function (err, fd) {
            if (err) {
                log.warn(err, 'open: failed');
                reply.error(nfs.NFS3ERR_SERVERFAULT);
                next(false);
                return;
            }

            call.stats = {
                fd: fd,
                size: stats.size
            };
            call.fd_cache.set(call.object, call.stats);

            log.debug('open(%s): done => %j', call.object, call.stats);
            next();
        });
    });
}



///--- Exports

module.exports = {
    fhandle_to_filename: fhandle_to_filename,
    handle_error: handle_error,
    open: open
};
