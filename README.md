# manta-nfs

`manta-nfs` implements a [NFS vers. 3](http://tools.ietf.org/html/rfc1813)
server which uses
[Joyent Manta](http://www.joyent.com/products/manta) as the backing store.
The server implements all NFS functionality, although some operations,
such as 'chmod', will have no effect since Manta does not support them.
Unlike Manta, the server provides normal POSIX write semantics via the use
of a local object cache.

## Overview

The server cannot run on a system which is already acting as a NFS server
since there would be a conflict on the required ports.
In this case, the server will detect the existing server and exit.

The server includes a built-in portmapper but it will also work transparently
with the system's portmapper (usually rpcbind) if one is running.

By default, the server will only listen on the localhost address and only
serve files locally. However, it can be configured to serve files to
external hosts.

Because the server caches Manta objects locally, care must be taken when
accessing Manta in different ways or from different locations. There is no
attempt to be coherent accross multiple systems. Given this, you should
not run more than one instance of the server for the same Manta user. Likewise,
you should not write to the same object using both NFS and the CLI. Reading
objects using both NFS and the CLI is obviously fine. If you write an object
using one mechanism (e.g. NFS) and immediately read it using another (e.g. the
CLI) then you may not see the same data. The server will hold an object locally
for a period of time before writing it back to Manta. Likewise, if you update
an existing object using the CLI, the server might have a stale copy in its
cache. In this case you can force the server to refresh its cached copy by
simply 'touch'ing the file.

## Configuration

At a minimum the server needs the configuration information necessary to
connect to a Manta account. If the Manta environment variables are already
in place, the server will use those. Since the server must be started as
root and if you're using 'sudo', use the '-E' option to pass those forward.
On some Linux distributions sudo will reset 'HOME' to root's home directory. On
those distributions you must also set HOME back to your home directory. e.g.

    sudo -E HOME=/home/foo ...

In addition to the Manta account information, there is a variety of other
configuration options. An example configuration file is provided in
`etc/example.json`. Each section of the configuration file is optional. The
configuration file is specified to the server via the '-f' option. e.g.

    node server.js -f etc/myconfig.json

Although most of the sections in the config file should be self-explanatory,
here is some additional information.

  * The `manta` section must be used to specify the required access information
    for Manta if the environment variables are not set.

  * The `database` section can be used to configure where the server will cache
    local copies of the Manta objects. The location, size of the cache and the
    time-to-live for the cache must be set if this section is provided.
    The default cache is under '/var/tmp/mfsdb' with a size limit of 1GB.

  * The `mount` section's `address` field can be used to specify an address
    other than localhost for the server to listen on. Using '0.0.0.0' tells the
    server to listen on all addresses. Both the mountd and nfsd within the
    server will listen on the given address. Since the server has full access
    to all of the user's Manta data, it is a good idea to limit foreign host
    access when listening on the external network. The `hosts_allow` or
    `hosts_deny` sections can be used to restrict access to the given IP
    addresses. The `exports` section can also be used to restrict access to
    the specified portions of the Manta filesystem.

  * The `nfs` section can be used set the `uid` and `gid` values for 'nobody'.
    This is useful if NFS clients are running a different OS which uses
    different values for 'nobody' as compared to the server (e.g. Darwin vs.
    Linux). Over NFS all files will appear to be owned by 'nobody' since there
    is no mechanism to map a Manta username to a local uid on the various
    clients, but within Manta all files continue to be owned by the user
    account. The `fd-cache` section can be used to configure the server's file
    descriptor cache, although this is normally not necessary.

## Usage

As mentioned, the server must be started as root, since it needs access
to the portmapper's privileged port, but once the server is running, it
lowers its uid to 'nobody' to improve security.

On Darwin or Linux, the server can be run like:

    sudo node server.js -f etc/myconfig.json

On SmartOS, the server can be run like:

    pfexec node server.js -f etc/myconfig.json

Once started, the server will output an occasional log message but the '-d'
or '-v' option can be used to change the logging level from 'info' to 'debug'
or 'trace'. All logging is done via Bunyan.

## OS Specific Considerations

This section discusses any issues that are specific to running the server on
a given operating system.

### Darwin

There is normally no portmapper running on Darwin so the server runs with it's
built-in portmapper.

The uid/gid for 'nobody' is -2.

### Linux

Some distributions (e.g. Ubuntu or Centos) may not come pre-installed with
the `/sbin/mount.nfs` command which is needed to perform a mount, while others
(e.g. Fedora) may be ready to go. On Ubuntu, install the `nfs-common` package.

    apt-get install nfs-common

On Centos, install the `nfs-utils` package.

    yum install nfs-utils

Installing these packages usually also causes 'rpcbind' to be installed and
started. However, due to a mis-design in the Linux rpcbind code, the server
will not be able to register with the system's rpcbind. There are two options
to workaround this:

  * Disable the system's rpcbind and let the server use its built-in
    portmapper. The method for disabling the system's rpcbind varies depending
    on the service manager that the system uses. If 'rpcbind' is in a seperate
    package from '/sbin/mount.nfs', then you could simply uninstall that
    package. To disable 'rpcbind' on Ubuntu you can run: `stop portmap`.

  * Run the system's rpcbind in 'insecure' mode using the -i option. Again,
    the location for specifying additional options for a service varies by
    distribution. On Ubuntu you can add the option in
    `/etc/init/portmap.conf`.

On Linux the uid/gid for 'nobody' is 65534.

There is no lock manager included in the server, so you must disable locking
when you mount. e.g.

    mount -o nolock 127.0.0.1:/foo.bar/public /home/foo/mnt

### SmartOS

In order to mount from the local host, the system's 'rpcbind' must be running.
The built-in portmapper cannot be used. If the svc is not already enabled,
enable it.

    svcadm enable network/rpc/bind

Due to a mis-design in the SmartOS mount code, mounting will fail on older
platforms. If you see the following, you know your mount code is incorrect.

    nfs mount: 127.0.0.1: : RPC: Program not registered
    nfs mount: retrying: /home/foo.bar/mnt

You will either need to run on a fixed platform or fixed versions of the
NFS mount and umount programs can be provided for interim relief.

On SmartOS the uid/gid for 'nobody' is 60001.
