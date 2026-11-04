const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** Indian-system words for a rupee amount, e.g. 1,23,456.50 -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only". */
export function rupeesInWords(amount: number): string {
  const total = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(total / 100);
  const paise = total % 100;
  if (rupees === 0 && paise === 0) return 'Rupees Zero Only';
  const units: [number, string][] = [
    [10000000, 'Crore'],
    [100000, 'Lakh'],
    [1000, 'Thousand'],
  ];
  let rest = rupees;
  const words: string[] = [];
  for (const [size, name] of units) {
    if (rest >= size) {
      words.push(`${below1000(Math.floor(rest / size))} ${name}`);
      rest %= size;
    }
  }
  if (rest > 0) words.push(below1000(rest));
  let out = `Rupees ${words.join(' ') || 'Zero'}`;
  if (paise) out += ` and ${below1000(paise)} Paise`;
  return `${out} Only`;
}
