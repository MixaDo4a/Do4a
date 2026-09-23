# Bubble Up: preservation and online architecture

The old browser prototype and its behavior remain in `preview/` and in the `bubble-up` branch. Its local browser data is deliberately not imported into Supabase. The online catalog starts empty and is populated only through `/admin`.

The online source of truth is Supabase Postgres:

- campaigns contain menus;
- menus contain products;
- one product per menu may be marked `is_main`;
- products can reference image and video URLs in the `drinkit-media` Storage bucket;
- addon groups and addons are linked through `product_addon_groups`.

The public application reads published catalog records through `/api/catalog`. The constructor writes through `/api/admin/catalog`. Media uploads go through `/api/media`, so files are stored as objects rather than Base64 in browser storage.

The target media capacity is at least 1.5 GB total. Supabase Free includes 1 GB Storage and limits each file to 50 MB; the project must use Pro or another storage plan before production uploads of large videos. The application limit is set to 500 MB per file so the API is ready for that plan, while Supabase's global and bucket limits remain the final enforcement layer.
