// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');

var common = require('./common');

var fs = require('fs');



///-- API

function read(req, res, next) {
    var log = req.log;

    log.debug('read(%s, %d, %d): entered', req.object, req.offset, req.count);

    req.fs.stat(req._filename, function (st_err, stats) {
        if (st_err) {
            req.log.warn(st_err, 'read: fsCache.stat failed');
            res.error(nfs.NFS3ERR_SERVERFAULT);
            next(false);
            return;
        }

        req.fs.open(req._filename, 'r', function (open_err, fd) {
            if (open_err) {
                req.log.warn(open_err, 'read: open failed');
                res.error(nfs.NFS3ERR_SERVERFAULT);
                next(false);
                return;
            }

            res.data = new Buffer(req.count);
            req.fs.read(fd, res.data, 0, req.count, req.offset,
              function (rd_err, n) {
                req.fs.close(fd, function (close_err) {
                    // we're ignoring errors on close
                    if (rd_err) {
                        req.log.warn(rd_err, 'read: failed');
                        res.error(nfs.NFS3ERR_SERVERFAULT);
                        next(false);
                        return;
                    }

                    // use stat.size to determine eof
                    var eof = false;
                    if (stats.size <= (req.offset + n))
                        eof = true;

                    log.debug('read(%d): done', n);
                    if (n < req.count) {
                        // some NFS clients verify that the returned buffer
                        // length matches the result count
                        var tmpb = res.data.slice(0, n);
                        res.data = tmpb;
                    }

                    res.count = n;
                    res.eof = eof;
                    res.send();
                    next();
                });
            });
        });
    });
}



///--- Exports

module.exports = function chain() {
    return ([
        common.fhandle_to_filename,
        read
    ]);
};
