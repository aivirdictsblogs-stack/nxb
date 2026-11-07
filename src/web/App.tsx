import { Route, Routes, Navigate } from 'react-router-dom';
import { AdminShell, DashLayout, SiteLayout } from './layouts';
import { Protected, Empty } from './lib';
import { AllProducts, Categories, Contact, Deals, Faq, Home, InfoPage, ProductDetail, ProductList, Trending, TrackOrder } from './pages/public';
import { Forgot, Login, Register, Reset, VerifyEmail } from './pages/auth';
import { Checkout, Notifications, OrderDetail, Orders, Overview, Settings, TicketThread, Tickets, Wallet } from './pages/account';
import * as A from './pages/admin';
import { Link } from 'react-router-dom';

const Perm = ({ p, children }: { p: string; children: React.ReactNode }) => <Protected staff perm={p}>{children}</Protected>;
export default function App() {
  return <Routes>
    <Route element={<SiteLayout />}>
      <Route index element={<Home />} /><Route path="products" element={<AllProducts />} /><Route path="products/:slug" element={<ProductDetail />} />
      <Route path="search" element={<AllProducts />} /><Route path="categories" element={<Categories />} /><Route path="categories/:slug" element={<ProductList title="Category" />} />
      <Route path="deals" element={<Deals />} /><Route path="trending" element={<Trending />} /><Route path="track-order" element={<TrackOrder />} />
      <Route path="about" element={<InfoPage kind="about" />} /><Route path="contact" element={<Contact />} /><Route path="faq" element={<Faq />} />
      <Route path="terms" element={<InfoPage kind="terms" />} /><Route path="privacy" element={<InfoPage kind="privacy" />} /><Route path="refund-policy" element={<InfoPage kind="refund" />} />
      <Route path="checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="*" element={<div className="mx-auto max-w-md p-16"><Empty title="Page not found" action={<Link className="btn-primary" to="/">Go home</Link>} /></div>} />
    </Route>
    <Route path="login" element={<Login />} /><Route path="register" element={<Register />} /><Route path="forgot-password" element={<Forgot />} /><Route path="reset-password" element={<Reset />} /><Route path="verify-email" element={<VerifyEmail />} />
    <Route path="dashboard" element={<Protected><DashLayout /></Protected>}>
      <Route index element={<Overview />} /><Route path="wallet" element={<Wallet />} /><Route path="orders" element={<Orders />} /><Route path="orders/:id" element={<OrderDetail />} />
      <Route path="tickets" element={<Tickets />} /><Route path="tickets/:id" element={<TicketThread />} /><Route path="notifications" element={<Notifications />} /><Route path="settings" element={<Settings />} />
    </Route>
    <Route path="admin" element={<Protected staff><AdminShell /></Protected>}>
      <Route index element={<A.Dashboard />} />
      <Route path="orders" element={<Perm p="orders.manage"><A.AdminOrders /></Perm>} />
      <Route path="deposits" element={<Perm p="deposits.review"><A.Deposits /></Perm>} />
      <Route path="customers" element={<Perm p="customers.manage,wallets.adjust"><A.Customers /></Perm>} />
      <Route path="products" element={<Perm p="products.manage"><A.Products /></Perm>} />
      <Route path="categories" element={<Perm p="products.manage"><A.Categories /></Perm>} />
      <Route path="inventory" element={<Perm p="inventory.manage"><A.Inventory /></Perm>} />
      <Route path="suppliers" element={<Perm p="payments.manage"><A.Suppliers /></Perm>} />
      <Route path="payment-methods" element={<Perm p="payments.manage"><A.PaymentMethods /></Perm>} />
      <Route path="coupons" element={<Perm p="coupons.manage"><A.Coupons /></Perm>} />
      <Route path="tickets" element={<Perm p="tickets.manage"><A.AdminTickets /></Perm>} />
      <Route path="content" element={<Perm p="content.manage"><A.Content /></Perm>} />
      <Route path="reports" element={<Perm p="reports.view"><A.Reports /></Perm>} />
      <Route path="staff" element={<Perm p="staff.manage"><A.Staff /></Perm>} />
      <Route path="audit" element={<Perm p="audit.view"><A.Audit /></Perm>} />
      <Route path="settings" element={<Perm p="settings.manage"><A.AdminSettings /></Perm>} />
    </Route>
    <Route path="*" element={<Navigate to="/" />} />
  </Routes>;
}
