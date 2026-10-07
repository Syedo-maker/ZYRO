import { lazy, Suspense } from 'react'
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LandingPage } from './pages/landing/LandingPage'
import { ShopDirectoryPage } from './pages/shop/ShopDirectoryPage'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'

/*
 * The landing page, the shop directory and the two sign-in screens load straight away: they are
 * what a first-time visitor actually opens.
 *
 * Everything below is loaded only when somebody navigates to it. The merchant dashboard, the
 * register and the storefronts are the bulk of the application, and shipping all of it to render a
 * marketing page is wasted bytes on the one page where loading quickly decides whether a visitor
 * stays. Each becomes its own chunk, fetched on the first navigation to it.
 */

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const ProductsPage = lazy(() => import('./pages/admin/ProductsPage').then((m) => ({ default: m.ProductsPage })))
const OrdersPage = lazy(() => import('./pages/admin/OrdersPage').then((m) => ({ default: m.OrdersPage })))
const TeamPage = lazy(() => import('./pages/admin/TeamPage').then((m) => ({ default: m.TeamPage })))
const BillingPage = lazy(() => import('./pages/admin/BillingPage').then((m) => ({ default: m.BillingPage })))
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const PaymentsPage = lazy(() => import('./pages/admin/PaymentsPage').then((m) => ({ default: m.PaymentsPage })))
const VoiceNotesPage = lazy(() => import('./pages/admin/VoiceNotesPage').then((m) => ({ default: m.VoiceNotesPage })))
const PlatformPage = lazy(() => import('./pages/admin/PlatformPage').then((m) => ({ default: m.PlatformPage })))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const MarketingPage = lazy(() => import('./pages/admin/MarketingPage').then((m) => ({ default: m.MarketingPage })))
const ReviewsAdminPage = lazy(() => import('./pages/admin/ReviewsAdminPage').then((m) => ({ default: m.ReviewsAdminPage })))
const StorefrontLayout = lazy(() => import('./pages/storefront/StorefrontLayout').then((m) => ({ default: m.StorefrontLayout })))
const StorefrontHome = lazy(() => import('./pages/storefront/StorefrontHome').then((m) => ({ default: m.StorefrontHome })))
const CartPage = lazy(() => import('./pages/storefront/CartPage').then((m) => ({ default: m.CartPage })))
const CheckoutPage = lazy(() => import('./pages/storefront/CheckoutPage').then((m) => ({ default: m.CheckoutPage })))
const OrderConfirmationPage = lazy(() => import('./pages/storefront/OrderConfirmationPage').then((m) => ({ default: m.OrderConfirmationPage })))
const OrderPlacedPage = lazy(() => import('./pages/storefront/OrderPlacedPage').then((m) => ({ default: m.OrderPlacedPage })))
const CatalogPage = lazy(() => import('./pages/storefront/CatalogPage').then((m) => ({ default: m.CatalogPage })))
const ProductPage = lazy(() => import('./pages/storefront/ProductPage').then((m) => ({ default: m.ProductPage })))
const CustomerAuthPage = lazy(() => import('./pages/storefront/account/CustomerAuthPage').then((m) => ({ default: m.CustomerAuthPage })))
const AccountPage = lazy(() => import('./pages/storefront/account/AccountPage').then((m) => ({ default: m.AccountPage })))
const AccountOrderPage = lazy(() => import('./pages/storefront/account/AccountOrderPage').then((m) => ({ default: m.AccountOrderPage })))
const PosLoginPage = lazy(() => import('./pages/pos/PosLoginPage').then((m) => ({ default: m.PosLoginPage })))
const HistoryPage = lazy(() => import('./pages/pos/HistoryPage').then((m) => ({ default: m.HistoryPage })))
const DailySummaryPage = lazy(() => import('./pages/pos/DailySummaryPage').then((m) => ({ default: m.DailySummaryPage })))
const PosEntry = lazy(() => import('./pages/pos/PosLayout').then((m) => ({ default: m.PosEntry })))
const PosLayout = lazy(() => import('./pages/pos/PosLayout').then((m) => ({ default: m.PosLayout })))
const PosRegisterPage = lazy(() => import('./pages/pos/RegisterPage').then((m) => ({ default: m.RegisterPage })))

/** Shown while a route's chunk is fetched. Deliberately blank: a flash of a spinner on a fast
 *  connection is more distracting than a moment of nothing. */
const Loading = <div className="min-h-screen bg-bg" />

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={Loading}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="products" replace />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="marketing" element={<MarketingPage />} />
              <Route path="reviews" element={<ReviewsAdminPage />} />
              <Route path="team" element={<TeamPage />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="payments" element={<PaymentsPage />} />
              <Route path="voice-notes" element={<VoiceNotesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="platform" element={<PlatformPage />} />
            </Route>

            <Route path="/pos" element={<PosEntry />} />
            <Route path="/pos/login" element={<PosLoginPage />} />
            <Route path="/pos/:storeId" element={<PosLayout />}>
              <Route index element={<PosRegisterPage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="summary" element={<DailySummaryPage />} />
            </Route>

            <Route path="/store/:storeId" element={<StorefrontLayout />}>
              <Route index element={<StorefrontHome />} />
              <Route path="products" element={<CatalogPage />} />
              <Route path="products/:productId" element={<ProductPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="account/login" element={<CustomerAuthPage mode="login" />} />
              <Route path="account/register" element={<CustomerAuthPage mode="register" />} />
              <Route path="account/orders/:orderId" element={<AccountOrderPage />} />
              <Route path="cart" element={<CartPage />} />
              <Route path="checkout" element={<CheckoutPage />} />
              <Route path="checkout/success" element={<OrderConfirmationPage />} />
              <Route path="checkout/placed" element={<OrderPlacedPage />} />
            </Route>

          {/* "/" used to send everybody to the merchant dashboard, which is wrong for a shopper,
                who has no shop at all. It is now the marketing homepage, whose two buttons are the
                role choice Issue 2 introduced; a signed-in visitor is redirected past it. */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/shop" element={<ShopDirectoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
