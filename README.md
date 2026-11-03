# My Money

A private personal-finance site: **net worth, stocks, spending and trends / FI projections**, fed live from **LHV** and **Interactive Brokers**.

- Each person runs **their own copy** with **their own free Supabase project**. Nobody shares data with anyone.
- Bank access is **read-only**. LHV login tokens and the IBKR token are **encrypted** in your database and never reach the browser.
- Only **one account** can ever log in to a copy: the first one created on it.

---

## What you need

- A **GitHub** account (free), for hosting the site with GitHub Pages
- A **Supabase** account (free plan is enough), for login, database and server functions
- **LHV** internet bank (Smart-ID / Mobile-ID), optional
- **Interactive Brokers** account, optional

## Setup (about 20 minutes)

### 1. Copy this repository
On GitHub, click **Use this template → Create a new repository**, make it **Public**, and give it any name.

### 2. Create a Supabase project
On [supabase.com](https://supabase.com), click **New project**. Pick a region in the EU, set a database password and wait until it's ready.

### 3. Create the database tables
In Supabase, open **SQL Editor → New query**. Paste everything from `supabase/migrations/001_init.sql` and click **Run**.

### 3b. Choose a one-time setup code
This stops anyone else from creating the owner account before you do. In the SQL Editor, run this, replacing `MY-SECRET-CODE` with something only you know:

```sql
insert into public.app_config(key, data) values ('setup_code_hash',
  rtrim(translate(encode(extensions.digest('MY-SECRET-CODE', 'sha256'), 'base64'), '+/', '-_'), '='));
```

You'll type this code once, when you create your account. After that it's deleted automatically.

### 4. Deploy the server functions
Install the [Supabase CLI](https://supabase.com/docs/guides/cli). Then run these commands in the repository folder on your computer:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF      # shown in Project Settings → General
supabase functions deploy lhv --no-verify-jwt
supabase functions deploy ibkr --no-verify-jwt
supabase functions deploy account --no-verify-jwt
```

`--no-verify-jwt` is needed because the functions check your login themselves. LHV's login page also has to be able to send you back to the site.

### 5. Point the site at your project
Edit `config.js`. You'll find both values in Supabase under **Project Settings → API**:

```js
window.MYMONEY_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseKey: "sb_publishable_..."   // the publishable / anon key
};
```

The publishable key is meant to be public. Your data is protected by your login and the database rules, not by hiding this key.

### 6. Turn on GitHub Pages
In your repository, go to **Settings → Pages**. Set **Source** to *Deploy from a branch*, choose **Branch: main, folder: / (root)** and click **Save**. After a minute your site is at `https://YOUR-NAME.github.io/REPO-NAME/`.

### 7. Create your account
Open your site. The first time, it asks you to **create an account** and for your **setup code** from step 3b. That account becomes the only one that can use the site.

Then, in Supabase, go to **Authentication → Sign In / Providers** and turn **off "Allow new users to sign up"**. This is extra safety; strangers couldn't see anything anyway.

### 8. Connect LHV
In the site, click **Connect LHV**. A new tab opens: log in with Smart-ID / Mobile-ID / ID-card and approve read access. LHV then sends that tab to a `localhost` address that **won't load. That's expected**: LHV only allows returning to localhost. Copy the whole address from that tab and paste it into the box on the site, then click **Finish connecting**. The code in that address works once, only for your own login, and expires in minutes. After that the server keeps the connection alive; if LHV ever asks you to log in again, repeat this.

### 9. Connect Interactive Brokers (Flex Web Service)
1. In IBKR **Client Portal**, go to **Performance & Reports → Flex Queries**.
2. Under **Activity Flex Query**, click **+** (Create). Name it e.g. `MyMoney`, then tick these sections:
   - **Account Information**: Currency
   - **Open Positions** (Summary): Symbol, Description, Asset Class, Currency, FX Rate To Base, Quantity, Mark Price, Position Value, Cost Basis Price, Unrealized P/L, Level of Detail
   - **Cash Report**: Currency, Ending Cash
   - **Net Asset Value (NAV) in Base**: Cash, Total
   - **Cash Transactions** (Detail): Currency, FX Rate To Base, Symbol, Description, Date/Time, Amount, Type. This is used for dividends.
   - **Format:** XML. **Period:** Last 365 Calendar Days. **Include Currency Rates:** Yes. Save it, and note the **Query ID** (a number).
3. On the same page, open **Flex Web Service Configuration**. Enable it and **generate a token**, choosing the longest validity.
4. In the site, go to **⚙ Settings → Interactive Brokers**, paste the **token** and **Query ID**, and click **Save**. The site tests the token before saving it.

IBKR numbers update once a day. That's how Flex works.

## Everyday use

- **Spending categories:** change any payment's category in the Spending tab, and the site remembers the rule for that merchant.
- **⚙ Settings** has:
  - pension and other assets, debts
  - what counts as income, and salary paid early for the next month
  - transfers to people
  - background picture
- **👁** blurs all amounts when you share your screen.

## Privacy and security notes

- The code in this repository contains no personal data, keys or tokens.
- Bank tokens are encrypted with a key derived from your project's secret service key, which never leaves Supabase.
- Only three read-only LHV tools can be called: accounts, portfolio and statements. Payments are impossible through this site.
- Browsers can only reach one table (`kv`), and only the owner's own rows. Token tables are server-only.
- Owner creation needs a one-time setup code; strangers who sign up get no data and no function access.
- The page loads no third-party scripts (libraries are self-hosted) and sets a strict Content-Security-Policy, so bank text is always shown as plain text.
