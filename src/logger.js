// Never serialize Discord errors: request bodies and headers can contain secrets.
export function safeError(error) {
  return {
    name: /^[A-Za-z][A-Za-z0-9]{0,50}$/.test(error?.name) ? error.name : 'Error',
    code: typeof error?.code === 'number' || /^[A-Z_\d]{1,50}$/.test(error?.code)
      ? error.code : undefined,
  };
}

export function log(level, event, details = {}) {
  const writer = level === 'error' ? console.error : console.log;
  writer(JSON.stringify({ time: new Date().toISOString(), level, event, ...details }));
}
