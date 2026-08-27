/* Protein Superstore — client configuration.
   Everything client-specific lives here. The modules themselves are untouched.

   Note on the key below: it is the Supabase ANON key, which is designed to be
   public and is protected by row level security. It is not a secret. No
   service key ever goes in front-end code. */

export const CONFIG = {
  /* One venue key per store. Each store gets its own menu, its own order
     board and its own numbers — which is what an extra store is actually
     buying. Adding one is a config change, not a build. */
  venue: 'psp-hartlepool',
  liveStores: ['hartlepool'],
  brandName: 'Protein Superstore',
  clientRef: 'psp',
  version: 'v1.3.1',

  sb: {
    url: 'https://coiwwbroycaznkmhevde.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvaXd3YnJveWNhem5rbWhldmRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5NzIwMjksImV4cCI6MjA5OTU0ODAyOX0.r-k8RjKqouqjekvEXSMKzJykKbtgpGLMZQXcXhAmRW8'
  },

  /* 10 points per £1 spent. */
  pointsPerPound: 10,

  rewards: [
    { name: 'Free protein slush',        cost: 400 },
    { name: 'Free protein bar',          cost: 250 },
    { name: '£5 off any supplement',     cost: 750 },
    { name: '20% off a full-size tub',   cost: 1500 }
  ],

  earnRules: [
    { icon: '🛒', label: 'Every £1 spent',        points: '10 pts' },
    { icon: '🥤', label: 'Slush of the week',     points: '50 pts' },
    { icon: '🎂', label: 'Birthday month',        points: '250 pts' },
    { icon: '⭐', label: 'Refer a training mate', points: '500 pts' }
  ],

  /* The five real stores. */
  stores: [
    { id: 'hartlepool',    name: 'Hartlepool',    address: '200 York Road, Hartlepool TS26 9EB',
      phone: '01429 261963', hours: 'Mon–Fri 10:00–18:00 · Sat 10:00–16:00 · Sun closed' },
    { id: 'sunderland',    name: 'Sunderland',    address: '11 Fawcett Street, Sunderland SR1 1SJ',
      phone: '0191 510 9763', hours: 'Mon–Fri 10:00–17:30 · Sat 10:00–17:00 · Sun 11:00–16:00' },
    { id: 'newcastle',     name: 'Newcastle',     address: 'Unit 27 Eldon Garden, Newcastle NE1 7RA',
      phone: '', hours: 'Mon–Sat 10:00–18:00 · Sun 11:00–17:00' },
    { id: 'middlesbrough', name: 'Middlesbrough', address: 'Unit 10B Captain Cook Square, Middlesbrough TS1 5UB',
      phone: '', hours: 'Mon–Fri 10:00–17:30 · Sat 10:00–17:00 · Sun 11:00–16:00' },
    { id: 'stockton',      name: 'Stockton',      address: '6 Wellington Street, Stockton TS18 1RH',
      phone: '', hours: 'Mon–Sat 10:00–17:30 · Sun 11:00–16:00' }
  ],

  /* The slush photograph is the blue one from the mockup. Picking another
     flavour tints it rather than swapping in a drawing — one asset, four
     flavours, and it still looks like a photo. */
  slushFilters: {
    'Blue Raspberry':        'none',
    'Cherry Burst':          'hue-rotate(190deg) saturate(1.5)',
    'Strawberry Watermelon': 'hue-rotate(150deg) saturate(1.25) brightness(1.05)',
    'Tropical Punch':        'hue-rotate(115deg) saturate(1.6) brightness(1.08)'
  },

  /* Product photography from the client's own Shopify CDN. Anything not
     listed falls back to a typographic tile rather than a fake product shot. */
  productImages: {
    "M&M's Protein Bar":
      'https://proteinsuperstore.co.uk/cdn/shop/products/m_m-protein-bar-chocolate_600x.jpg?v=1672494867'
  }
};

export const STORE_KEY = 'psp_store';
export const USER_KEY  = 'psp_user';
