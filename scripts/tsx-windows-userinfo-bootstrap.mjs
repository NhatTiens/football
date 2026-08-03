// Node 24 on some Windows hosts can make os.userInfo() fail with uv_os_get_passwd
// before tsx loads application code. tsx prefers process.geteuid() when present,
// so provide a process-local, non-privileged identity only for its temp-dir name.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 0,
  });
}
