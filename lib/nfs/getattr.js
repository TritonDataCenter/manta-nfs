// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');

var fsCache = require('../fs-cache');



///-- API

function ensure_fs_cache(req, res, next) {
    var p = req.object;

    req.log.debug('ensure_fs_cache(%s): entered', p);

    function fail() {
        res.error(nfs.NFS3ERR_BADHANDLE);
        next(false);
    }

    try {
        req.cache = fsCache.getCacheByFhandle(p);
    } catch (e) {
        req.log.error(e, 'getattr: %s is invalid', p);
        fail();
        return;
    }

    if (!req.cache) {
        fail();
        return;
    }

    req.cache.lookup(req.object, function (err, name) {
        if (err) {
            fail();
        } else {
            req._filename = name;
            req.log.debug({filename: name}, 'ensure_fs_cache(%s): done', p);
            next();
        }
    });
}


function getattr(req, res, next) {
    req.cache.stat(req._filename, function (err, stats) {
        if (err) {
            req.log.warn(err, 'getattr: fsCache.stat failed');
            res.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        // if (stats.is_directory) {

        // }

        res.setAttributes(stats);
        res.send();
        next();
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        ensure_fs_cache,
        getattr
    ]);
};
