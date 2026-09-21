import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { LoginPage } from './pages/Login'
import { RegisterPage } from './pages/Register'
import { AdminLayout } from './pages/admin/AdminLayout'
import { ProductsPage } from './pages/admin/ProductsPage'
import { OrdersPage } from './pages/admin/OrdersPage'
import { StorefrontLayout } from './pages/storefront/StorefrontLayout'
import { StorefrontHome } from './pages/storefront/StorefrontHome'
import { CartPage } from './pages/storefront/CartPage'
import { CheckoutPage } from './pages/storefront/CheckoutPage'
import { OrderConfirmationPage } from './pages/storefront/OrderConfirmationPage'
import { TeamPage } from './pages/admin/TeamPage'
import { DashboardPage } from './pages/admin/DashboardPage'
import { MarketingPage } from './pages/admin/MarketingPage'
import { ReviewsAdminPage } from './pages/admin/ReviewsAdminPage'
import { CatalogPage } from './pages/storefront/CatalogPage'
import { ProductPage } from './pages/storefront/ProductPage'
import { CustomerAuthPage } from './pages/storefront/account/CustomerAuthPage'
import { AccountPage } from './pages/storefront/account/AccountPage'
import { AccountOrderPage } from './pages/storefront/account/AccountOrderPage'
import { PosEntry, PosLayout } from './pages/pos/PosLayout'
import { PosLoginPage } from './pages/pos/PosLoginPage'
import { RegisterPage as PosRegisterPage } from './pages/pos/RegisterPage'
import { HistoryPage } from './pages/pos/HistoryPage'
import { DailySummaryPage } from './pages/pos/DailySummaryPage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
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
          </Route>

          <Route path="/" element={<Navigate to="/admin/products" replace />} />
          <Route path="*" element={<Navigate to="/admin/products" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
