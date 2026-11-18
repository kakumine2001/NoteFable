// Normalize any Unicode decimal digit (General_Category=Decimal_Number, \p{Nd})
// such as Arabic-Indic ٤٨٢٩١٠, Extended Arabic-Indic ۴۸۲۹۱۰, Devanagari, Thai or
// Fullwidth digits to ASCII 0-9. Every Unicode Nd block is 10 consecutive digits 0-9.
export function normalizeDecimalDigits(value: string): string {
  return value.replace(/\p{Nd}/gu, (digit) => {
    const codePoint = digit.codePointAt(0)!;
    let zero = codePoint;
    while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--;
    return String((codePoint - zero) % 10);
  });
}

// Keep up to 6 decimal digits (normalized to ASCII 0-9), stripping spaces, dashes and non-digits.
export function cleanLoginCode(value: string): string {
  return normalizeDecimalDigits(value).replace(/\D/g, "").slice(0, 6);
}
