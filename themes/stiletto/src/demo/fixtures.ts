import { mockProduct } from "@markaz/storefront-data";
import type { MockFixtures, MockProductInput } from "@markaz/storefront-data";

/**
 * The Stiletto demo catalogue. Generated at patch time from the original project's mock catalogue (amounts are carried
 * over as they are, in rupees) plus two bra and panty sets for the collection that catalogue left empty.
 */
const products: MockProductInput[] = [
  {
    "id": "prod_stiletto_001",
    "slug": "harper-blazer-in-navy",
    "title": "Harper Blazer In Navy",
    "currency": "PKR",
    "price": 399,
    "compareAtPrice": 479,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=700&q=80",
      "alt": "Harper Blazer In Navy"
    },
    "categories": [
      {
        "id": "cat_blazers",
        "slug": "blazers",
        "name": "BLAZERS"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Harper Blazer In Navy from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=700&q=80",
        "alt": "Harper Blazer In Navy"
      },
      {
        "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=80",
        "alt": "Harper Blazer In Navy"
      },
      {
        "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=80",
        "alt": "Harper Blazer In Navy"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [
      "blazer"
    ],
    "categorySlugs": [
      "blazers"
    ],
    "deliveryCharge": 0
  },
  {
    "id": "prod_stiletto_002",
    "slug": "classic-check-blazer",
    "title": "Classic Check Blazer",
    "currency": "PKR",
    "price": 350,
    "compareAtPrice": null,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=700&q=80",
      "alt": "Classic Check Blazer"
    },
    "categories": [
      {
        "id": "cat_blazers",
        "slug": "blazers",
        "name": "BLAZERS"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Classic Check Blazer from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1591369822096-ffd140ec948f?auto=format&fit=crop&w=700&q=80",
        "alt": "Classic Check Blazer"
      },
      {
        "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=80",
        "alt": "Classic Check Blazer"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [
      "blazer"
    ],
    "categorySlugs": [
      "blazers"
    ],
    "deliveryCharge": 0
  },
  {
    "id": "prod_stiletto_003",
    "slug": "piper-dress-in-noir",
    "title": "Piper Dress In Noir",
    "currency": "PKR",
    "price": 289,
    "compareAtPrice": null,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=80",
      "alt": "Piper Dress In Noir"
    },
    "categories": [
      {
        "id": "cat_dresses",
        "slug": "dresses",
        "name": "DRESSES"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Piper Dress In Noir from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=700&q=80",
        "alt": "Piper Dress In Noir"
      },
      {
        "url": "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=700&q=80",
        "alt": "Piper Dress In Noir"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [
      "dress"
    ],
    "categorySlugs": [
      "dresses"
    ],
    "deliveryCharge": 0
  },
  {
    "id": "prod_stiletto_004",
    "slug": "oversized-leather-jacket",
    "title": "Oversized Leather Jacket",
    "currency": "PKR",
    "price": 450,
    "compareAtPrice": null,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=700&q=80",
      "alt": "Oversized Leather Jacket"
    },
    "categories": [
      {
        "id": "cat_jackets",
        "slug": "jackets",
        "name": "JACKETS"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Oversized Leather Jacket from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=700&q=80",
        "alt": "Oversized Leather Jacket"
      },
      {
        "url": "https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=700&q=80",
        "alt": "Oversized Leather Jacket"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [
      "jacket"
    ],
    "categorySlugs": [
      "jackets"
    ],
    "deliveryCharge": 0
  },
  {
    "id": "prod_stiletto_005",
    "slug": "dakota-maxi-skirt",
    "title": "Dakota Maxi Skirt",
    "currency": "PKR",
    "price": 229,
    "compareAtPrice": null,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=700&q=80",
      "alt": "Dakota Maxi Skirt"
    },
    "categories": [
      {
        "id": "cat_maxis",
        "slug": "maxis",
        "name": "MAXIS"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Dakota Maxi Skirt from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?auto=format&fit=crop&w=700&q=80",
        "alt": "Dakota Maxi Skirt"
      },
      {
        "url": "https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=700&q=80",
        "alt": "Dakota Maxi Skirt"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [
      "maxi"
    ],
    "categorySlugs": [
      "maxis"
    ],
    "deliveryCharge": 0
  },
  {
    "id": "prod_stiletto_006",
    "slug": "everyday-cotton-bra-panty-set",
    "title": "Everyday Cotton Bra & Panty Set",
    "currency": "PKR",
    "price": 1499,
    "compareAtPrice": null,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1568663521381-33b7c467fda0?w=900&auto=format&fit=crop&q=70",
      "alt": "Everyday Cotton Bra & Panty Set"
    },
    "categories": [
      {
        "id": "cat_bra-and-panty-sets",
        "slug": "bra-and-panty-sets",
        "name": "BRA AND PANTY SETS"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Everyday Cotton Bra & Panty Set from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1568663521381-33b7c467fda0?w=900&auto=format&fit=crop&q=70",
        "alt": "Everyday Cotton Bra & Panty Set"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [],
    "categorySlugs": [
      "bra-and-panty-sets"
    ],
    "deliveryCharge": 0
  },
  {
    "id": "prod_stiletto_007",
    "slug": "seamless-comfort-set",
    "title": "Seamless Comfort Set",
    "currency": "PKR",
    "price": 1799,
    "compareAtPrice": null,
    "stockStatus": "in_stock",
    "primaryImage": {
      "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=70",
      "alt": "Seamless Comfort Set"
    },
    "categories": [
      {
        "id": "cat_bra-and-panty-sets",
        "slug": "bra-and-panty-sets",
        "name": "BRA AND PANTY SETS"
      }
    ],
    "avgRating": 0,
    "reviewCount": 0,
    "description": "Seamless Comfort Set from the Stiletto demo collection.",
    "highlights": [],
    "images": [
      {
        "url": "https://images.unsplash.com/photo-1595777457583-95e059d581b8?auto=format&fit=crop&w=900&q=70",
        "alt": "Seamless Comfort Set"
      }
    ],
    "seo": {
      "title": null,
      "description": null,
      "imageUrl": null
    },
    "tags": [],
    "categorySlugs": [
      "bra-and-panty-sets"
    ],
    "deliveryCharge": 0
  }
];

export const stilettoFixtures: MockFixtures = { products: products.map(mockProduct) };
