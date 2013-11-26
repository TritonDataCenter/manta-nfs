// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var path = require('path');

var assert = require('assert-plus');
var nfs = require('nfs');

var auth = require('../auth');

var getattr = require('./getattr');



///--- API

function createNfsServer(opts) {
    assert.object(opts, 'options');
    assert.object(opts.database, 'options.database');
    assert.object(opts.log, 'options.log');
    assert.object(opts.manta, 'options.manta');

    var s = nfs.createNfsServer({
        log: opts.log
    });


    s.use(auth.authorize);
    s.use(function setup(req, res, next) {
        req.db = opts.database;
        req.manta = opts.manta;
        next();
    });

    s.getattr(getattr());

    s.on('after', function (name, call, reply, err) {
        opts.log.info({
            procedure: name,
            rpc_call: call,
            rpc_reply: reply,
            err: err
        }, 'nfsd: %s handled', name);
    });

    return (s);
}



///--- Exports

module.exports = {
    createNfsServer: createNfsServer
};
