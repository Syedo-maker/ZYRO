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
          </Route>

          <Route path="/store/:storeId" element={<StorefrontLayout />}>
            <Route index element={<StorefrontHome />} />
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
