export function normalizePointInput(input: string): string {
  if (input === "") {
    return "0";
  }
  if (!/^\d+$/.test(input)) {
    throw new Error(`point input must contain only decimal digits: '${input}'`);
  }
  return input.replace(/^0+(?=\d)/, "");
}
