import { LastSeenPipe } from './last-seen.pipe';

describe('LastSeenPipe', () => {
  let pipe: LastSeenPipe;

  const ago = (seconds: number): string =>
    pipe.transform(new Date(Date.now() - seconds * 1000));

  beforeEach(() => {
    pipe = new LastSeenPipe();
  });

  it('returns an empty string for a missing timestamp', () => {
    // null means "never seen online since the upgrade" - the caller decides
    // whether to show anything at all, so the pipe must not invent a value.
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });

  it('returns an empty string for unparseable input', () => {
    expect(pipe.transform('not-a-date')).toBe('');
  });

  it('says "just now" for anything under a minute', () => {
    expect(ago(0)).toBe('только что');
    expect(ago(30)).toBe('только что');
    expect(ago(59)).toBe('только что');
  });

  it('does not render a future timestamp as "in N minutes"', () => {
    // Clock skew between a phone and the server is normal; the user has not
    // left in the future.
    const future = new Date(Date.now() + 5 * 60 * 1000);
    expect(pipe.transform(future)).toBe('только что');
  });

  it('pluralises minutes', () => {
    expect(ago(60)).toBe('1 минуту назад');
    expect(ago(120)).toBe('2 минуты назад');
    expect(ago(5 * 60)).toBe('5 минут назад');
    expect(ago(21 * 60)).toBe('21 минуту назад');
    expect(ago(22 * 60)).toBe('22 минуты назад');
    expect(ago(25 * 60)).toBe('25 минут назад');
  });

  it('gets the teens right, where the naive rule gets them wrong', () => {
    // 11-14 take the "many" form even though the last digit is 1-4.
    expect(ago(11 * 60)).toBe('11 минут назад');
    expect(ago(12 * 60)).toBe('12 минут назад');
    expect(ago(14 * 60)).toBe('14 минут назад');
  });

  it('pluralises hours', () => {
    expect(ago(3600)).toBe('1 час назад');
    expect(ago(2 * 3600)).toBe('2 часа назад');
    expect(ago(5 * 3600)).toBe('5 часов назад');
    expect(ago(23 * 3600)).toBe('23 часа назад');
  });

  it('pluralises days and weeks', () => {
    expect(ago(24 * 3600)).toBe('1 день назад');
    expect(ago(3 * 24 * 3600)).toBe('3 дня назад');
    expect(ago(6 * 24 * 3600)).toBe('6 дней назад');
    expect(ago(8 * 24 * 3600)).toBe('1 неделю назад');
    expect(ago(20 * 24 * 3600)).toBe('2 недели назад');
  });

  it('pluralises months and years', () => {
    expect(ago(40 * 24 * 3600)).toBe('1 месяц назад');
    expect(ago(100 * 24 * 3600)).toBe('3 месяца назад');
    expect(ago(200 * 24 * 3600)).toBe('6 месяцев назад');
    expect(ago(400 * 24 * 3600)).toBe('1 год назад');
    expect(ago(1000 * 24 * 3600)).toBe('2 года назад');
    expect(ago(2000 * 24 * 3600)).toBe('5 лет назад');
  });

  it('accepts the ISO string the API sends', () => {
    const iso = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(pipe.transform(iso)).toBe('3 часа назад');
  });

  it('treats an empty-but-present timestamp as missing', () => {
    expect(pipe.transform(' ')).toBe('');
  });
});
