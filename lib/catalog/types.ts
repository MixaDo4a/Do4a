export type CatalogProduct = {
  id: string;
  menu_id: string;
  name: string;
  price: number;
  description: string;
  details: string;
  calories: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  is_main: boolean;
  image_url: string | null;
  video_url: string | null;
  sort_order: number;
};

export type CatalogMenu = {
  id: string;
  campaign_id: string;
  name: string;
  sort_order: number;
  products: CatalogProduct[];
};

export type CatalogCampaign = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  menus: CatalogMenu[];
};
