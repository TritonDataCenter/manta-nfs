// Copyright 2014 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var fs = require('fs');
var path = require('path');
var util = require('util');

var assert = require('assert-plus');
var clone = require('clone');
var nfs = require('nfs');
var once = require('once');
var statvfs = require('statvfs');

var auth = require('./auth');
var common = require('./nfs/common');



///--- Globals

var sprintf = util.format;

var MNTPATHLEN = 1024; // This is defined by the RFC



///--- API

function ensure_exports(req, res, next) {
    assert.string(req.dirpath, 'req.dirpath');

    var p = path.normalize(req.dirpath);

    if (p.length > MNTPATHLEN) {
        res.error(nfs.MNT3ERR_NAMETOOLONG);
        next(false);
        return;
    }

    // export entries are optional
    if (req.exports && !req.exports[p]) {
        res.error(nfs.MNT3ERR_NOENT);
        next(false);
        return;
    }

    req._dirpath = p;
    next();
}


function ensure_manta_dir(req, res, next) {
    var p = req._dirpath;

    req.log.debug('ensure_manta_directory(%s): entered', p);
    req.manta.info(p, function (err, info) {
        if (err) {
            req.log.warn(err, 'ensure_manta_directory: info(%s) failed', p);
            res.error(nfs.MNT3ERR_SERVERFAULT);
            next(false);
            return;
        }

        if (info.extension !== 'directory') {
            req.log.warn({
                path: p,
                info: info
            }, 'mount: manta location is not a directory');
            res.error(nfs.MNT3ERR_NOTDIR);
            next(false);
            return;
        }

        req.log.debug({
            info: info
        }, 'ensure_manta_directory(%s): done', p);

        req.info = info;
        next();
    });
}


function mount(call, reply, next) {
    var log = call.log;

    log.debug('mount(%s): entered', call._dirpath);
    call.fs.stat(call._dirpath, function (serr, dummystats) {
        if (serr) {
            log.warn(serr, 'mount(%s): failed to stat', call._dirpath);
            reply.error(nfs.MNT3ERR_SERVERFAULT);
            next(false);
            return;
        }

        call.fs.lookup(call._dirpath, function (lerr, fhandle) {
            if (lerr) {
                log.warn(lerr, 'mount(%s): failed to lookup', call._dirpath);
                reply.error(nfs.MNT3ERR_SERVERFAULT);
                next(false);
                return;
            }

            reply.setFileHandle(fhandle);
            log.debug('mount(%s): done -> %s', call._dirpath, fhandle);
            reply.send();
            next();

            // We assume the client is going to immediately do an ls, so just
            // cache the root directory
            call.fs.readdir(call._dirpath, function () {});
        });
    });
}


function umount(call, reply, next) {
    var log = call.log;

    // We don't invoke call.fs.shutdown here since the server is still running
    // and they may want to mount again later.

    log.debug('umount(%s) done', call._dirpath);
    reply.send();
    next();
}


function createMountServer(opts) {
    assert.object(opts, 'options');
    assert.optionalObject(opts.exports, 'options.exports');
    assert.object(opts.log, 'options.log');
    assert.object(opts.manta, 'options.manta');
    assert.object(opts.fs, 'options.fs');

    var s = nfs.createMountServer({
        log: opts.log
    });

    s.use(auth.authorize);
    s.use(function setup(req, res, next) {
        req.exports = opts.exports;
        req.manta = opts.manta;
        req.fs = opts.fs;
        next();
    });
    s.mnt(ensure_exports,
          ensure_manta_dir,
          mount);

    s.umnt(ensure_exports,
          umount);

    s.on('after', function (name, call, reply, err) {
        opts.log.debug({
            procedure: name,
            rpc_call: call,
            rpc_reply: reply,
            err: err
        }, 'mountd: %s handled', name);
    });

    return (s);
}



///--- Exports

module.exports = {
    createMountServer: createMountServer
};
