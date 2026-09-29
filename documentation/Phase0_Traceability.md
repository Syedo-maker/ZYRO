# Phase 0: Screen to Endpoint Traceability

Closes the Phase 0 gap in `Phase_Gates_Checklist.md`: every wireframe in `design/wireframes/` is listed with the API operations (the `operationId`s in `backend/openapi.yaml`) its screen calls, and the screens built later without a wireframe are listed too. Two tests keep this honest:

- `backend/tests/unit/contract.test.ts`: every wireframe file appears in the first table, and every `operationId` named in this document exists in `openapi.yaml`.
- `backend/tests/integration/contract-routes.test.ts`: every path and method in `openapi.yaml` is answered by the real server (never "Route not found").

Design-only files (no screen of their own) are marked as such: `NavigationFlow` and `POSFlow` draw how screens connect, and `ComponentInventory` and `POSComponents` list the building blocks.

## Wireframes

| Wireframe | Screen | Operations it uses |
|---|---|---|
| Main.dc.html | Storefront home | stores_get, products_list, products_categories, products_recommendations |
| CategoryListing.dc.html | Category and search results | products_list, products_categories, products_suggest |
| ProductDetail.dc.html | Product page with reviews | products_get, reviews_list, reviews_create, reviews_update_mine, reviews_delete_mine, products_recommendations, cart_items_add |
| Cart.dc.html | Cart | cart_get, cart_items_update, cart_items_remove, cart_merge |
| Checkout.dc.html | Checkout | checkout_quote_create, discount_codes_validate, checkout_session_create |
| OrderConfirmation.dc.html | Order confirmation | checkout_session_get, orders_get |
| AIAssistant.dc.html | Shopping assistant chat | assistant_chat_send |
| AdminCatalog.dc.html | Admin products and product form with AI tools | products_list, products_create, products_update, products_delete, uploads_image_create, ai_content_get, ai_content_generate, ai_content_update, ai_content_regenerate, ai_content_publish, ai_content_auto_tag, ai_content_seo_metadata, ai_content_marketing_copy, ai_content_review_summary_get, ai_content_review_summary_generate, ai_usage_get |
| AdminOrders.dc.html | Admin orders and shipping | orders_list, orders_get, orders_status_update, orders_shipment_upsert, orders_refund, shipping_zones_list, shipping_zones_create, shipping_zones_update, shipping_zones_delete |
| AdminDashboard.dc.html | Admin dashboard | analytics_summary_get, orders_list, ai_usage_get, insights_get, insights_generate |
| AdminMarketing.dc.html | Marketing: discount codes, cart-recovery performance, sales by category | discount_codes_list, discount_codes_create, discount_codes_update, cart_recovery_performance_get, analytics_summary_get |
| NavigationFlow.dc.html | Design only: how the screens connect | none |
| ComponentInventory.dc.html | Design only: shared components | none |
| pos/POSLogin.dc.html | Register sign in | auth_login, users_me_stores_list, pos_session |
| pos/Main.dc.html | Register (selling) | pos_session, pos_shift_current, pos_shift_open, pos_shift_close, pos_products_search, pos_quote, pos_held_list, pos_held_create, pos_held_resume, pos_held_discard |
| pos/POSCustomerPicker.dc.html | Choose a customer at the register | pos_customers_search, pos_customers_create |
| pos/POSPayment.dc.html | Take payment | pos_quote, pos_sale_create |
| pos/POSSaleComplete.dc.html | Sale complete | pos_sale_get |
| pos/POSReceipt.dc.html | Printable receipt | pos_sale_get |
| pos/POSHistory.dc.html | Sales history | pos_sales_list, pos_sale_get |
| pos/POSReturn.dc.html | Return items | pos_sale_get, pos_sale_return |
| pos/POSDailySummary.dc.html | Daily summary | pos_report_daily |
| pos/POSFlow.dc.html | Design only: how the register screens connect | none |
| pos/POSComponents.dc.html | Design only: register components | none |

## Screens built without a wireframe

These were added in later phases; the screen itself was designed in code.

| Screen | Added in | Operations it uses |
|---|---|---|
| Merchant sign up and sign in | Phase 1 | auth_register, auth_login, auth_refresh, auth_logout, users_me_get, users_me_stores_list |
| Customer sign up, sign in, My account and order | Phase 3 | auth_register_customer, auth_login, orders_mine, orders_get |
| Team and register settings | Phase 2.5 | store_staff_list, store_staff_create, store_staff_delete, pos_session, pos_settings_update |
| Reviews moderation | Phase 3 | reviews_moderation_list, reviews_moderate |
| Store branding | Phase 1 | store_branding_update, stores_get |
| Plan and billing | Part A | billing_overview, billing_subscribe, billing_top_up, billing_portal, plans_list, store_domain_update |
| Platform | Part A | platform_summary, platform_tenants |

## Not called by any screen

`webhooks_stripe_handle` is called by Stripe, never by the app.
