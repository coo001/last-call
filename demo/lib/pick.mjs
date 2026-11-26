// Renders by experiment variation. `flag` is what getExperimentFlag returned (or a plain value).
export function pick(flag, options) {
  const key = typeof flag === 'object' && flag !== null ? flag.variant ?? flag.value : flag;
  return key in options ? options[key] : options.control;
}
