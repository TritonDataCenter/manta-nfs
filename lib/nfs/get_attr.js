// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.



///-- API

function check_database(req, res, next) {
    var log = req.log;

    log.debug('getattr.check_database(%s): entered', req.object);
    this.db.lookup_fhandle(req.object, {log: req.log}, function (err, val) {
        if (err) {
            log.warn(err, 'getattr.check_database(%s): failed', req.object);
            res.error(err.code);
            next(false);
        } else {
            req.finfo = val;
            log.debug({
                value: req.finfo
            }, 'getattr.check_database(%s): done', req.object);
            next();
        }
    });
}


function get_attr(req, res, next) {
    // var f = FILE_HANDLES[req.object]
    // fs.lstat(f, function (err, stats) {
    //     if (err) {
    //         req.log.warn(err, 'get_attr: lstat failed');
    //         res.error(nfs.NFS3ERR_STALE);
    //         next(false);
    //     } else {
    //         res.setAttributes(stats);
    //         res.send();
    //         next();
    //     }
    // });
}



///--- Exports

module.exports = function chain() {
    return ([
        get_attr
    ]);
};
