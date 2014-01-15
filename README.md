# manta-nfs

`manta-nfs` implements a NFS vers. 3 server which uses
[Joyent Manta](http://www.joyent.com/products/manta)as the backing store.
The server implements all NFS functionality, although some operations,
such as `chmod` will have no effect, since Manta does not support that.
Unlike Manta, the server provides normal POSIX write semantics via the use
of a local object cache.

## Overview

The server cannot run on a system which is already acting as a NFS server
since there would be a conflict with the use of the standard ports.
In the case, the server will detect the existing server and exit.

The server includes a built-in portmapper but it will also work transparently
with the system's portmapper (usually rpcbind) if one is running.

By default, the server will only listen on the localhost address and only
serve files locally, however, it can be configured to serve files to
external hosts.


## Configuration

At a minimum the server needs the configuration information necessary to
connect to a Manta account. If the Manta environment variables are already
in place, the server will use those. Since the server must be started as
root, use the `-E` option, if running `sudo`, to pass those forward. On some
Linux distributions `sudo` will reset `HOME` to root's home directory. On
those distributions you must also set `HOME` back to your home directory. e.g.

    sudo -E HOME=/home/foo ...

In addition to the Manta account information, there are a variety of other
configuration options. An example configuration file is provided in
etc/example.json. Each section of the configuration file is optional. The
configuration file is specified to the server via the `-f` option. e.g.

    node server.js -f etc/myconfig.json

Although most of the sections in the config file should be self-explanatory,
here is some additional information.

  * As mentioned above, the `manta` section can be used to specify the
    required access information for Manta if the environment variables are
    not being used.

  * The `database` section can be used to configure where the server will cache
    local copies of the Manta objects. The location, size of the cache and the
    time-to-live for the cache must be set if this section is provided.

  * The `mount` section's `address` field can be used to specify an address
    other than localhost for the server to listen on. Using `0.0.0.0` tells the
    server to listen on all addresses. Both the mountd and nfsd within the
    server will listen on the given address. Since the server has full access
    to all of the user's Manta data, it is a good idea to limit foreign host
    access when listening on the external network. The `hosts_allow` or
    `hosts_deny` sections can be used to restrict access to the given IP
    addresses. The `exports` section can also be used to restrict access to
    the specified portions of the Manta filesystem.

  * The `nfs` section can be used set the `uid` and `gid` values for `nobody`.
    This is useful if NFS clients are running a different OS which uses
    different values for `nobody` as compared to the server (e.g. Darwin vs.
    Linux). All files will appear to be owned by `nobody` since there is no
    mechanism to map a Manta username to a local uid on the various clients,
    but within Manta all files continue to be owned by the user account. The
    `fd-cache` section can be used to configure the server's file descriptor
    cache, although this is normally not necessary.

## Usage

As mentioned, the server must be started as root, since it needs access
to the portmapper's privileged port, but once the server is running, it
changes it ownership to `nobody` to improve security.

On Darwin or Linux, the server can be run like:

    sudo node server.js -f etc/myconfig.json

On SmartOS, the server can be run like:

    pfexec node server.js -f etc/myconfig.json

Once started, the server will output an occasional log message but the `-d`
or `-v` option can be used to change the logging level from `info` to `debug`
or `trace`. All logging is done via Bunyan.

## OS Specific Considerations

This section discusses any issues that are specific to running the server on
a given operating system.

### Darwin

There is normally no portmapper running on Darwin so the server runs with it's
built-in portmapper.

The uid/gid for `nobody` is -2.

### Linux

Some distributions (e.g. Ubuntu or Centos) may not come pre-installed with
the `/sbin/mount.nfs` command which is needed to perform a mount, while others
(e.g. Fedora) may be ready to go. On Ubuntu, install the `nfs-common` package.

    apt-get install nfs-common

On Centos, install the `nfs-utils` package.

    yum install nfs-utils

Installing these packages usually also causes `rpcbind` to be installed and
started. However, due to a mis-design in the Linux rpcbind code, the server
will not be able to register with the system's rpcbind. There are two options
to workaround this:

  * Disable the system's rpcbind and let the server use its built-in
    portmapper. The method for disabling the system's rpcbind varies depending
    on the service manager that the system uses. If `rpcbind` is in a seperate
    package from `/sbin/mount.nfs`, the you can simply uninstall that package.
    To disable `rpcbind` on Ubuntu you can run: `stop portmap`.

  * Run the system's rpcbind in 'insecure' mode using the -i option. Again,
    the location for specifying additional options for a service varies by
    distribution. On Ubuntu you can add the option to
    `/etc/init/portmap.conf`.

On Linux the uid/gid for `nobody` is 65534.

There is no lock manager included in the server, so you must disable that when
you mount. e.g.

    mount -o nolock 127.0.0.1:/foo.bar/public /home/foo/mnt

### SmartOS

In order to mount from the local host, the system's `rpcbind` must be running.
The built-in portmapper cannot be used. If the svc is not already enabled,
enable it.

    svcadm enable network/rpc/bind

Due to a mis-design in the SmartOS mount code, mounting will fail on older
platforms. If you see the following, you know your mount code is incorrect.

    nfs mount: 127.0.0.1: : RPC: Program not registered
    nfs mount: retrying: /home/foo.bar/mnt

You will either need to run on a fixed platform or fixed versions of the
NFS mount and umount programs can be provided for interim relief.

On SmartOS the uid/gid for `nobody` is 60001.
