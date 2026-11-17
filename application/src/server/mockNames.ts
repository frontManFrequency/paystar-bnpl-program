/**
 * Realistic-looking (fictional) display names applied on top of the immutable fixture at seed time.
 * Keyed by stable fixture IDs. Identifiers such as DEMO-NID-* / DEMO-SAYAD-* stay unchanged on purpose:
 * the mock adapters accept only those, which keeps real identities from ever being processed.
 * All organizations here are fictional; none refers to a real bank or clinic.
 */
import type { Q } from './db';

export const ORG_NAMES: Record<string, string> = {
  'd2be8100-9ef3-5193-82df-b6c4fa69d2ef': 'پی‌استار',
  '53c1a926-518d-5ac4-a7bf-16645a00feb2': 'کلینیک دندان‌پزشکی لبخند',
  'fcbc147a-da7f-5aa6-8523-70d3e822746b': 'کلینیک دندان‌پزشکی آرتین',
  'fc3f0eae-e086-5dbe-99a5-54a2614c8b5f': 'بانک آسمان‌نو',
};

/** user id → [display name, first name, last name, father's name, birthplace] */
export const USER_NAMES: Record<string, [string, string, string, string?, string?]> = {
  '3ba651a2-0961-5516-b7c1-46ac3a4e30bf': ['مهدی کریمی', 'مهدی', 'کریمی'],
  '123e1547-df44-5136-899c-db7aef8ef5cd': ['لیلا صادقی', 'لیلا', 'صادقی'],
  '60f62d83-325b-5637-a584-1df65f5867ee': ['سارا احمدی', 'سارا', 'احمدی'],
  'bf77da54-5bcf-5693-b2bf-eb0565514096': ['رضا محمدی', 'رضا', 'محمدی'],
  '2c0e76e8-ea41-595d-bb31-58afc419bf8f': ['دکتر نرگس رحیمی', 'نرگس', 'رحیمی'],
  'a9f8a6f5-764c-5e43-a27b-028c416c8e5f': ['علی موسوی', 'علی', 'موسوی'],
  '42dc56d6-2464-5ef7-b0f2-a030e83a2511': ['دکتر حامد شریفی', 'حامد', 'شریفی'],
  '2e08e074-0f22-5660-91e3-26efa97ee297': ['محمد حسینی', 'محمد', 'حسینی'],
  '374a51dc-17fd-523d-bf7f-0786c376b985': ['فاطمه نوری', 'فاطمه', 'نوری'],
  'bff10b5d-2880-5a7e-88e8-9afdf9234534': ['مریم رضایی', 'مریم', 'رضایی', 'حسن', 'تهران'],
  '65df61e5-207d-5382-a18a-544a7d498fd1': ['امیر جعفری', 'امیر', 'جعفری', 'محمود', 'اصفهان'],
  'b709f17b-b4d0-50c0-b218-1d9f0e5ae5cd': ['زهرا کاظمی', 'زهرا', 'کاظمی', 'علی', 'شیراز'],
  'c912d778-1738-533b-88a6-c8cf48202537': ['حسین مرادی', 'حسین', 'مرادی', 'عباس', 'تبریز'],
  '8eac6417-5692-5666-94da-3f247a9a6890': ['نیلوفر اکبری', 'نیلوفر', 'اکبری', 'مجید', 'مشهد'],
  '83c2b64a-e574-51a0-8668-06609cf9d12d': ['کامران یوسفی', 'کامران', 'یوسفی', 'رحیم', 'کرج'],
};

const CATALOG: Record<string, string> = {
  'c988a0bb-c531-5fc4-8bee-16602ba71c7f': 'معاینه و مشاوره دندان‌پزشکی',
  '174fec14-f5e6-5b58-b86e-7b29f5190f79': 'ایمپلنت دندان (یک واحد، با روکش)',
};

const ADDRESSES = ['تهران، خیابان ولیعصر، کوچه یاس، پلاک ۱۲', 'تهران، سعادت‌آباد، خیابان سرو، پلاک ۴۵', 'تهران، نارمک، خیابان گلبرگ، پلاک ۸', 'تهران، پونک، بلوار عدل، پلاک ۲۱', 'تهران، شهرک غرب، خیابان ایران‌زمین، پلاک ۳۳', 'تهران، تهرانپارس، خیابان جشنواره، پلاک ۷'];

export async function applyMockNames(t: Q) {
  for (const [id, name] of Object.entries(ORG_NAMES)) await t.q('UPDATE organizations SET name=$2 WHERE id=$1', [id, name]);
  await t.q("UPDATE organizations SET slug='artin' WHERE id='fcbc147a-da7f-5aa6-8523-70d3e822746b'");
  let i = 0;
  for (const [id, [display, first, last, father, place]] of Object.entries(USER_NAMES)) {
    await t.q('UPDATE users SET display_name=$2 WHERE id=$1', [id, display]);
    if (father) {
      const patch = { name: first, family_name: last, father_name: father, birthplace: place, address: ADDRESSES[i++ % ADDRESSES.length], postal_code: `1${String(4000000000 + i * 1234567).slice(1)}` };
      await t.q("UPDATE customers SET identity_details = identity_details || $2::jsonb WHERE user_id=$1", [id, JSON.stringify(patch)]);
    }
  }
  for (const [id, title] of Object.entries(CATALOG)) await t.q('UPDATE catalog_items SET title=$2 WHERE id=$1', [id, title]);
  await t.q("UPDATE support_cases SET summary='درخواست مهلت یک‌ماهه به دلیل هزینه‌های درمانی پیش‌بینی‌نشده' WHERE case_type='HARDSHIP'");
}
