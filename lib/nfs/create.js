// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');
var path = require('path');

var common = require('./common');

var fs = require('fs');


///-- API

function create_lookup_dir(call, reply, next) {
    var log = call.log;

    log.debug('create_lookup_dir(%s): entered', call.where.dir);
    call.fs.fhandle_to_path(call.where.dir, function (err, name) {
        if (err) {
            log.warn(err, 'create_lookup_dir(%s): fhandle_to_path notfound',
                call.where.dir);
            reply.error(nfs.NFS3ERR_STALE);
            next(false);
        } else {
            call._dirname = name;
            call._filename = path.join(name, call.where.name);
            log.debug('create_lookup_dir(%s): done -> %s', call.where.dir,
                name);
            next();
        }
    });
}


function create(req, res, next) {
    var log = req.log;

    log.debug('create(%s, %d): entered', req.object, req.how);

    if (req.how === nfs.create_how.EXCLUSIVE) {
        log.warn('create: exclusive not allowed');
        res.error(nfs.NFS3ERR_NOTSUPP);
        next(false);
        return;
    }

    var flags;
    if (req.how === nfs.create_how.UNCHECKED) {
        flags = 'w';
    } else if (req.how === nfs.create_how.GUARDED) {
        flags = 'wx';
    }

    var mode = 0644;
    if (req.obj_attributes.mode !== null)
        mode = req.obj_attributes.mode;

    req.fs.open(req._filename, flags, mode, function (open_err, fd) {
        if (open_err) {
            req.log.warn(open_err, 'create: open failed');
            res.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        req.fs.close(fd, function (close_err) {
            // we're ignoring errors on close
            next();
        });
    });
}


// XXX chown support?
function create_chown(req, reply, next) {
//    var log = req.log;
//
//            var uid;
//            var gid;
//
//            if (req.obj_attributes.uid === null ||
//                req.obj_attributes.gid === null) {
//                try {
//                    var stats = fs.lstatSync(dir);
//                    uid = stats.uid;
//                    gid = stats.gid;
//                } catch (e) {
//                    req.log.warn(e, 'create: lstat failed');
//                }
//            }
//
//            if (req.obj_attributes.uid !== null)
//                uid = req.obj_attributes.uid;
//
//            if (req.obj_attributes.gid !== null)
//                gid = req.obj_attributes.gid;
//
//            try {
//                fs.chownSync(nm, uid, gid);
//            } catch (e) {
//                req.log.warn(e, 'create: chown failed');
//            }

        next();
}


function create_lookup(call, reply, next) {
    var log = call.log;

    log.debug('create_lookup(%s): entered', call._filename);
    call.fs.lookup(call._filename, function (err, fhandle) {
        if (err) {
            log.warn(err, 'create_lookup(%s): failed', call._filename);
            reply.error(nfs.NFS3ERR_NOENT);
            next(false);
            return;
        }

        log.debug('create_lookup(%s): done', fhandle);
        reply.obj = fhandle;

        next();
    });
}


function create_stat(call, reply, next) {
    var log = call.log;

    log.debug('create_stat(%s): entered', call._filename);
    call.fs.stat(call._filename, function (err, stats) {
        if (err) {
            log.warn(err, 'create_stat(%s): failed', call._filename);
            reply.error(nfs.NFS3ERR_NOENT);
            next(false);
            return;
        }

        reply.setObjAttributes(stats);
        log.debug({stats: stats}, 'create_stat(%s): done', call._filename);
        reply.send();
        next();
    });
}


///--- Exports

module.exports = function chain() {
    return ([
        create_lookup_dir,
        create,
        create_lookup,
        create_stat
    ]);
};