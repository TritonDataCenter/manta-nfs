// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var fs = require('fs');
var path = require('path');
var util = require('util');

var assert = require('assert-plus');
var clone = require('clone');
var joi = require('joi');
var libuuid = require('libuuid');
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

    if (!req.exports[p]) {
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
        });
    });
}


function createMountServer(opts) {
    assert.object(opts, 'options');
    assert.object(opts.exports, 'options.exports');
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

    s.on('after', function (name, call, reply, err) {
        opts.log.info({
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



// function ensure_cache_dir(req, res, next) {
//     var p = req.exports[req._dirpath].cache.location;

//     req.log.debug('ensure_cache_directory(%s): entered', p);

//     fs.stat(p, function (err, stats) {
//         if (err) {
//             if (err.code !== 'ENOENT') {
//                 nfs.handle_error(err, req, res, next);
//             } else {
//                 fs.mkdir(p, 0700, function (err2) {
//                     if (err2) {
//                         nfs.handle_error(err2, req, res, next);
//                         next(false);
//                     } else {
//                         req.log.debug({
//                             created: true
//                         }, 'ensure_cache_directory(%s): done', p);
//                         next();
//                     }
//                     return;
//                 });
//             }
//         } else if (!stats.isDirectory()) {
//             req.log.error({
//                 path: p,
//                 stats: stats
//             }, 'mount: cache location is not a directory');
//             res.error(nfs.MNT3ERR_NOTDIR);
//             next(false);
//         } else {
//             req.log.debug({
//                 stats: stats
//             }, 'ensure_cache_directory(%s): done', p);
//             next();
//         }
//     });



//     statvfs(p, function (err, stats) {
//         if (err) {
//             nfs.handle_error(err, req, res, next);
//             return;
//         }

//         var free = Math.floor((stats.bsize * stats.bavail) / (1024 * 1024));

//         if (c.size < free) {
//             req.log.warn({
//                 path: p,
//                 available: free,
//                 cache_size: c.size
//             }, 'mount: cache location is smaller than desired cache size');
//             res.error(nfs.MNT3ERR_IO);
//             next(false);
//             return;
//         }

//         req.log.debug({
//             stats: stats
//         }, 'ensure_cache_space(%s): done', p);
//         next();
//     });
// }



    // Object.keys(opts.exports).forEach(function (k) {
    //     var e = opts.exports[k];
    //     var c = e.cache;

    //     assert.object(c, k + '.cache');
    //     assert.string(c.location, k + '.cache.location');
    //     assert.optionalNumber(c.expiration, k + '.cache.expiration');
    //     assert.optionalNumber(c.size, k + '.cache.size');

    //     assert.optionalNumber(e.rsize, k + '.rsize');
    //     assert.optionalNumber(e.wsize, k + '.wsize');
    //     assert.optionalBool(e.ro, k + '.ro');
    //     assert.optionalString(e.sec, k + '.sec');

    //     c.location = path.normalize(c.location);
    //     c.expiration = c.expiration || 3600;
    //     c.size = c.size || 5 * 1024 * 1024 * 1024; // 5 GB
    //     e.rsize = e.rsize || 32768;
    //     e.wsize = e.wsize || 32768;
    //     e.ro = e.ro || false;
    //     e.sec = e.sec || 'sys';
    // });

    // var c = req.connection;
    // var d = new Date().getTime();
    // var fhandle = libuuid.create();


    // var fkey = sprintf(db.fhandles.key, fhandle);
    // var fval = {
    //     ip: c.remoteAddress,
    //     path: req._dirpath,
    //     time: d
    // };
    // var log = req.log;
    // var mkey = sprintf(db.mounts.key, req._dirpath);
    // var mval = {
    //     fhandle: fhandle,
    //     ip: c.remoteAddress,
    //     time: d
    // };
    // var v_err;
    //function (err, fhandle) {
    //     if (err) {
    //         log.warn(err, 'mount(%s): unable to create local directory');
    //         res.error(nfs.MNT3ERR_SERVERFAULT);
    //         next(false);
    //     } else {
    //         res.setFileHandle(fhandle);
    //         log.debug('mount(%s): done', req._dirpath);
    //         res.send();
    //         next();
    //     }
    // });

    // if ((v_err = joi.validate(fval, db.fhandles.schema)) !== null) {
    //     log.error({
    //         joi_err: v_err
    //     }, 'mount(%s): schema failure', req._dirpath);
    //     res.error(nfs.MNT3ERR_SERVERFAULT);
    //     next(false);
    //     return;
    // } else if ((v_err = joi.validate(mval, db.mounts.schema)) !== null) {
    //     log.error({
    //         joi_err: v_err
    //     }, 'mount(%s): schema failure', req._dirpath);
    //     res.error(nfs.MNT3ERR_SERVERFAULT);
    //     next(false);
    //     return;
    // }

    // req.db.batch()
    //     .put(mkey, mval)
    //     .put(fkey, fval)
    //     .write(function (err) {
    //         if (err) {
    //             log.error(err, 'mount(%s): leveldb failed', req._dirpath);
    //             res.error(nfs.MNT3ERR_SERVERFAULT);
    //             next(false);
    //         } else {
    //             res.setFileHandle(fhandle);
    //             log.debug('mount(%s): entered', req._dirpath);
    //             res.send();
    //             next();
    //         }
    //     });
