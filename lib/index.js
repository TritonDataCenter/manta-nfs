// Copyright 2013 Joyent, Inc.  All rights reserved.
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

var fs = require('fs');
var path = require('path');

var assert = require('assert-plus');
var bunyan = require('bunyan');
var manta = require('manta');
var once = require('once');



///--- Helpers

function _export(obj) {
    Object.keys(obj).forEach(function (k) {
        module.exports[k] = obj[k];
    });
}



///--- API

var BUNYAN_SERIALIZERS = {
    err: bunyan.stdSerializers.err,
    rpc_call: function serialize_rpc_call(c) {
        return (c ? c.toString() : null);
    },
    rpc_reply: function serialize_rpc_reply(r) {
        return (r ? r.toString() : null);
    }
};


function createLogger(name, stream) {
    var l = bunyan.createLogger({
        name: name || path.basename(process.argv[1]),
        level: process.env.LOG_LEVEL || 'error',
        stream: stream || process.stdout,
        serializers: BUNYAN_SERIALIZERS
    });

    return (l);
}


function createMantaClient(opts) {
    assert.object(opts, 'options');
    assert.string(opts.keyId, 'options.keyId');
    assert.string(opts.keyFile, 'options.keyFile');
    assert.object(opts.log, 'options.log');
    assert.string(opts.url, 'options.url');
    assert.string(opts.user, 'options.user');

    var client = manta.createClient({
        sign: manta.privateKeySigner({
            key: fs.readFileSync(opts.keyFile, 'utf8'),
            keyId: opts.keyId,
            user: opts.user
        }),
        log: opts.log.child({component: 'MantaClient'}, true),
        url: opts.url,
        user: opts.user
    });

    return (client);
}



///--- Exports

module.exports = {
    bunyan: {
        createLogger: createLogger,
        serializers: BUNYAN_SERIALIZERS
    },
    createLogger: createLogger,
    createMantaClient: createMantaClient
};

_export(require('./mount'));
_export(require('./nfs'));
_export(require('./portmap'));
