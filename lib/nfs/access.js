// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var nfs = require('nfs');

var fsCache = require('../fs-cache');

var common = require('./common');



///-- API

function access(call, reply, next) {
    reply.access =
        nfs.ACCESS3_READ    |
        nfs.ACCESS3_LOOKUP  |
        nfs.ACCESS3_MODIFY  |
        nfs.ACCESS3_EXTEND  |
        nfs.ACCESS3_DELETE  |
        nfs.ACCESS3_EXECUTE;
    reply.send();
    next();
}



///--- Exports

module.exports = function chain() {
    return ([
        common.get_cache_by_fhandle,
        common.fhandle_to_filename,
        common.ensure_file_in_cache,
        access
    ]);
};
