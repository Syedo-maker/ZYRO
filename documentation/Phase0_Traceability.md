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
| ProductDetail.dc.html | Product page with reviews and haggling (Part G) | products_get, reviews_list, reviews_create, reviews_update_mine, reviews_delete_mine, products_recommendations, cart_items_add, bargain_offer, bargain_start, bargain_turn |
| Cart.dc.html | Cart | cart_get, cart_items_update, cart_items_remove, cart_merge |
| Checkout.dc.html | Checkout, with cash on delivery and bank transfer (Part E) | checkout_quote_create, discount_codes_validate, checkout_session_create, payments_options, payments_place_order, payments_help |
| OrderConfirmation.dc.html | Order confirmation | checkout_session_get, orders_get |
| AIAssistant.dc.html | Shopping assistant chat | assistant_chat_send |
| AdminCatalog.dc.html | Admin products and product form with AI tools | products_list, products_create, products_update, products_delete, bargain_settings_get, uploads_image_create, ai_content_get, ai_content_generate, ai_content_update, ai_content_regenerate, ai_content_publish, ai_content_auto_tag, ai_content_seo_metadata, ai_content_marketing_copy, ai_content_review_summary_get, ai_content_review_summary_generate, ai_usage_get |
| AdminOrders.dc.html | Admin orders and shipping | orders_list, orders_get, orders_status_update, orders_shipment_upsert, orders_refund, shipping_zones_list, shipping_zones_create, shipping_zones_update, shipping_zones_delete |
| AdminDashboard.dc.html | Admin dashboard, with this week's growth tip (Part C) and market trends (Part D) | analytics_summary_get, orders_list, ai_usage_get, insights_get, insights_generate, advisor_get, advisor_check, advisor_update, advisor_tip_dismiss, trends_store_get |
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
| Platform, with the Trend Scout panel (Part D) | Part A | platform_summary, platform_tenants, platform_trends_list, platform_trends_imports_list, platform_trends_import, platform_trends_run |
| Settings (store currency, and ways to pay) | After Part C | store_currency_get, store_currency_update, payments_settings_get, payments_settings_update |
| Order placed (cash on delivery or transfer, and sending in the receipt) | Part E | payments_proof_image, payments_submit_proof, payments_proof_status |
| Voice notes (spoken changes, confirmed by the merchant) | Part G | voice_note_create, voice_notes_list, voice_note_apply, voice_note_discard |
| Payments (cash-on-delivery queue, screenshots, courier cash) | Part E | payments_cod_pending, payments_cod_outcome, payments_proofs_list, payments_proof_review, payments_remittances_list, payments_remittance_import, payments_remittance_get |
| Landing screen ("Shop" or "Start a store") | Issue 2 | users_me_preference_update, users_me_get |
| Public shop directory (/shop) | Issue 2 | stores_directory_list, stores_directory_categories, stores_get |
| Public directory settings, inside Settings | Issue 2 | store_directory_listing_get, store_branding_update |
| Write with AI, on the Add product form | Issue 1 | product_ideas_suggest, product_ideas_keywords, products_create |
| Landing page (marketing homepage at /) | Landing page | demo_product_ideas, demo_product_ideas_examples, plans_list, stores_directory_list |

## Not called by any screen

`webhooks_stripe_handle` is called by Stripe, never by the app.
