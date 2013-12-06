// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');

var common = require('./common');



///-- API

function setattr(req, res, next) {
    req.log.debug('setattr(%s): entered', req.object);
    res.error(nfs.NFS3ERR_ACCES);
    next(false);
}


///--- Exports

module.exports = function chain() {
    return ([
        setattr
    ]);
};
