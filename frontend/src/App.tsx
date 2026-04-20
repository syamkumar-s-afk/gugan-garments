import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

type Role = 'user' | 'admin';
type AuthUser = { id: string; name: string; email: string; role: Role };
type Session = { token: string; user: AuthUser };
type CartItem = {
  productId: string;
  name: string;
  image: string;
  selectedSize: string;
  quantity: number;
  price: number;
  stock: number;
};

type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  brand: string;
  status: 'ACTIVE' | 'DRAFT' | 'OUT_OF_STOCK';
  basePrice: number;
  finalPrice: number;
  images?: Array<{ id: string; url: string }>;
  variants: Array<{ id: string; size: string; color: string; stockQuantity: number }>;
};

type Order = {
  id: string;
  orderNumber: string;
  customerName: string;
  status: 'ORDER_PLACED' | 'DISPATCHED' | 'SHIPPING' | 'OUT_FOR_DELIVERY' | 'DELIVERED';
  totalAmount: number;
};

const API = (import.meta.env.VITE_API_URL as string) || 'http://localhost:4000';
const REQUEST_TIMEOUT_MS = 12000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_KEY = 'gf_user_session';
const ADMIN_KEY = 'gf_admin_session';
const CART_KEY = 'gf_cart_session';
const PRODUCT_CATEGORIES = ['Men', 'Women', 'Kids', 'Accessories', 'Footwear', 'Beauty', 'Home', 'Sports', 'Ethnic'];
const steps = ['ORDER_PLACED', 'DISPATCHED', 'SHIPPING', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;
const colors = ['#141b34', '#4169e1', '#22c55e', '#f59e0b', '#ef4444'];

function formatINR(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

function readSession(key: string): Session | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

function writeSession(key: string, session: Session) {
  localStorage.setItem(key, JSON.stringify(session));
}

function clearSession(key: string) {
  localStorage.removeItem(key);
}

function readCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
}

function validateCredentials(email: string, password: string) {
  if (!EMAIL_REGEX.test(email.trim())) return 'Enter a valid email address.';
  if (password.trim().length < 6) return 'Password must be at least 6 characters.';
  return '';
}

async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...options, headers, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw new Error('Unable to connect to the server. Check API and network.');
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `Request failed (${res.status})`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

function RouteMeta() {
  const location = useLocation();

  useEffect(() => {
    let robots = document.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.appendChild(robots);
    }

    const isAdminRoute = location.pathname.startsWith('/admin.com');
    robots.content = isAdminRoute ? 'noindex,nofollow' : 'index,follow';
    document.title = isAdminRoute ? 'Gugan Admin' : 'Gugan Fashions';
  }, [location.pathname]);

  return null;
}

function UserLoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const session = readSession(USER_KEY);
    if (session?.user.role === 'user') navigate('/home', { replace: true });
  }, [navigate]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const validationError = validateCredentials(email, password);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (mode === 'signup' && name.trim().length < 2) {
      setError('Enter your name.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      const endpoint = mode === 'signup' ? '/auth/user/signup' : '/auth/user/login';
      const payload = mode === 'signup'
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password };

      const data = await api<{ accessToken: string; user: AuthUser }>(endpoint, undefined, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (data.user.role !== 'user') throw new Error('Unauthorized user access.');
      writeSession(USER_KEY, { token: data.accessToken, user: data.user });
      navigate('/home', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
      clearSession(USER_KEY);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Gugan Fashions</h1>
        <p>User Access</p>
        <div className="inline" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <button type="button" className={mode === 'login' ? '' : 'ghost'} onClick={() => setMode('login')}>Login</button>
          <button type="button" className={mode === 'signup' ? '' : 'ghost'} onClick={() => setMode('signup')}>Sign Up</button>
        </div>

        {mode === 'signup' && (
          <>
            <label htmlFor="user-name">Name</label>
            <input id="user-name" value={name} onChange={(e) => setName(e.target.value)} />
          </>
        )}

        <label htmlFor="user-email">Email</label>
        <input id="user-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="user-password">Password</label>
        <input id="user-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />

        <button type="submit" disabled={busy}>{busy ? 'Signing in...' : mode === 'signup' ? 'Create Account' : 'Sign In'}</button>
        {error && <p className="flash flash-error">{error}</p>}
      </form>
    </main>
  );
}

function UserHomePage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(() => readSession(USER_KEY));
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Array<any>>([]);
  const [cart, setCart] = useState<CartItem[]>(() => readCart());
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [orderSuccess, setOrderSuccess] = useState('');

  useEffect(() => {
    if (!session?.token) {
      setLoading(false);
      return;
    }

    api<{ user: AuthUser }>('/auth/me', session.token)
      .then((res) => {
        if (res.user.role !== 'user') throw new Error('Unauthorized');
      })
      .catch(() => {
        clearSession(USER_KEY);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, [session]);

  useEffect(() => {
    api<Array<any>>('/storefront/products').then(setProducts).catch(() => {});
  }, []);

  useEffect(() => {
    writeCart(cart);
  }, [cart]);

  function logout() {
    clearSession(USER_KEY);
    setSession(null);
    navigate('/', { replace: true });
  }

  function addToCart(product: any) {
    setOrderError('');
    setOrderSuccess('');
    if (!product || product.stock <= 0) {
      setOrderError('This product is out of stock.');
      return;
    }

    const defaultSize = product.sizes?.find((s: any) => s.stockQuantity > 0)?.size || 'Free';
    const maxStock = product.sizes?.find((s: any) => s.size === defaultSize)?.stockQuantity ?? product.stock;
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.productId === product.id && item.selectedSize === defaultSize);
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        if (existing.quantity >= maxStock) {
          setOrderError('Selected quantity exceeds available stock.');
          return prev;
        }
        const next = [...prev];
        next[existingIndex] = { ...existing, quantity: existing.quantity + 1, stock: maxStock };
        return next;
      }

      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          image: product.image,
          selectedSize: defaultSize,
          quantity: 1,
          price: product.finalPrice,
          stock: maxStock,
        },
      ];
    });
  }

  function updateCartQuantity(productId: string, selectedSize: string, nextQty: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.productId !== productId || item.selectedSize !== selectedSize) return item;
          const clamped = Math.max(1, Math.min(nextQty, item.stock));
          return { ...item, quantity: clamped };
        })
        .filter((item) => item.quantity > 0),
    );
  }

  function removeFromCart(productId: string, selectedSize: string) {
    setCart((prev) => prev.filter((item) => !(item.productId === productId && item.selectedSize === selectedSize)));
  }

  async function placeOrder() {
    if (!session?.token) return;
    if (!cart.length) {
      setOrderError('Your cart is empty.');
      return;
    }
    if (placingOrder) return;

    setPlacingOrder(true);
    setOrderError('');
    setOrderSuccess('');

    try {
      const payload = {
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          selectedSize: item.selectedSize,
        })),
      };

      await api('/orders', session.token, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setCart([]);
      clearCart();
      setOrderSuccess('Order placed successfully.');
      const refreshed = await api<Array<any>>('/storefront/products');
      setProducts(refreshed);
      navigate('/home', { replace: true });
    } catch (err: any) {
      setOrderError(err.message || 'Failed to place order');
    } finally {
      setPlacingOrder(false);
    }
  }

  if (loading) return <main className="auth-shell"><section className="auth-card"><p>Loading...</p></section></main>;
  if (!session || session.user.role !== 'user') return <Navigate to="/" replace />;

  const navItems = ['Men', 'Women', 'Kids', 'Home', 'All Brands', 'More'];
  const categories = ['Westernwear', 'Indianwear', 'Men', 'Footwear', 'Lingerie', 'Athleisure', 'Kids', 'Bags', 'Jewellery', 'Sneakers'];
  const featureItems = [
    { title: 'Free Delivery', text: 'From eligible orders' },
    { title: 'Money Back', text: 'Refund in 7 days' },
    { title: 'Secure Payment', text: 'Encrypted checkout' },
    { title: 'Member Discount', text: 'Extra deals every week' },
  ];
  const testimonials = [
    { name: 'Sandeep Singh', text: 'Wide range of fashion options and reliable delivery experience.' },
    { name: 'Gursavak Singh', text: 'Great platform to quickly find quality products for every occasion.' },
    { name: 'Riya Verma', text: 'Clean experience and smooth checkout. Loved the curation.' },
  ];
  const brands = ['Athletic Wear That Moves', 'Clean Style, True Quality', 'Comfort Made Classy', 'Style As Unique As You', 'Everyday Sharp Looks'];
  const newArrivals = [...products, ...products, ...products].slice(0, 8);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <main className="fashion-home">
      <div className="fh-top-strip">
        <span>App Download</span>
        <span>Help</span>
      </div>

      <header className="fh-header">
        <div className="fh-logo">
          <strong>GUGAN</strong>
          <small>FASHIONS</small>
        </div>
        <nav className="fh-nav">
          {navItems.map((item) => (
            <a key={item} href="#">{item}</a>
          ))}
        </nav>
        <input className="fh-search" placeholder="Search for products, styles, brands" />
        <div className="fh-actions">
          <button className="ghost">Cart ({cartCount})</button>
          <button className="ghost">Account</button>
          <button className="ghost">Wishlist</button>
          <button onClick={logout}>Logout</button>
        </div>
      </header>

      <section className="fh-hero">
        <img
          src="https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?auto=format&fit=crop&w=1600&q=80"
          alt="Street wear"
        />
        <div className="fh-hero-overlay">
          <p>NEW COLLECTION</p>
          <h1>STREET Wear</h1>
          <span>For {session.user.name || 'you'}</span>
        </div>
      </section>

      <section className="fh-category-row">
        {categories.map((item) => (
          <button key={item} className="fh-chip">{item}</button>
        ))}
      </section>

      <section className="fh-section">
        <h2>NEW ARRIVALS</h2>
        <div className="fh-product-grid">
          {newArrivals.map((item, idx) => (
            <article key={`${item.id}-${idx}`} className="fh-product-card">
              <img src={item.image} alt={item.name} />
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <div className="price-row">
                <span>{formatINR(item.finalPrice)}</span>
                {item.finalPrice !== item.originalPrice && <small>{formatINR(item.originalPrice)}</small>}
              </div>
              <button onClick={() => addToCart(item)} disabled={item.stock <= 0}>{item.stock > 0 ? 'Add to Cart' : 'Sold Out'}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="fh-section">
        <h2>CART</h2>
        <div className="fh-cart">
          {!cart.length && <p>Your cart is empty.</p>}
          {cart.map((item) => (
            <article key={`${item.productId}-${item.selectedSize}`} className="fh-cart-item">
              <img src={item.image} alt={item.name} />
              <div>
                <h4>{item.name}</h4>
                <p>Size: {item.selectedSize}</p>
                <p>{formatINR(item.price)}</p>
              </div>
              <div className="fh-cart-actions">
                <button onClick={() => updateCartQuantity(item.productId, item.selectedSize, item.quantity - 1)}>-</button>
                <span>{item.quantity}</span>
                <button onClick={() => updateCartQuantity(item.productId, item.selectedSize, item.quantity + 1)} disabled={item.quantity >= item.stock}>+</button>
                <button className="ghost" onClick={() => removeFromCart(item.productId, item.selectedSize)}>Remove</button>
              </div>
            </article>
          ))}
          <div className="fh-cart-footer">
            <strong>Total: {formatINR(cartTotal)}</strong>
            <button onClick={placeOrder} disabled={!cart.length || placingOrder}>{placingOrder ? 'Placing Order...' : 'Place Order'}</button>
          </div>
          {orderError && <p className="flash flash-error">{orderError}</p>}
          {orderSuccess && <p className="flash">{orderSuccess}</p>}
        </div>
      </section>

      <section className="fh-promo-grid">
        {['BIBA', 'MAX', 'MARKS & SPENCER', 'VERO MODA', 'ONLY'].map((brand, idx) => (
          <article key={brand} className="fh-promo-card">
            <img src={`https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=500&q=80&sig=${idx + 31}`} alt={brand} />
            <h4>{brand}</h4>
            <p>Up to 60% Off</p>
          </article>
        ))}
      </section>

      <section className="fh-banner">
        <img
          src="https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=1600&q=80"
          alt="Street trending"
        />
        <div>
          <p>SUMMER EXCLUSIVE COLLECTION</p>
          <h2>STREET TRENDING 2026</h2>
        </div>
      </section>

      <section className="fh-feature-strip">
        {featureItems.map((item) => (
          <article key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.text}</span>
          </article>
        ))}
      </section>

      <section className="fh-testimonials">
        <h3>Listen from our partners</h3>
        <div className="fh-testimonial-grid">
          {testimonials.map((item) => (
            <article key={item.name}>
              <strong>{item.name}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="fh-brands">
        <h3>Our Brands</h3>
        <div className="fh-brand-grid">
          {brands.map((item, idx) => (
            <article key={item}>
              <img src={`https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=400&q=80&sig=${idx + 100}`} alt={item} />
              <span>{item}</span>
            </article>
          ))}
        </div>
      </section>

      <footer className="fh-footer">
        <div className="fh-footer-links">
          <section>
            <h4>Who Are We</h4>
            <a href="#">About Us</a>
            <a href="#">Careers</a>
            <a href="#">Press</a>
          </section>
          <section>
            <h4>Help</h4>
            <a href="#">Shipping & Returns</a>
            <a href="#">Terms & Conditions</a>
            <a href="#">Privacy Policy</a>
          </section>
          <section>
            <h4>Quick Links</h4>
            <a href="#">Offers</a>
            <a href="#">Stores</a>
            <a href="#">Gift Cards</a>
          </section>
          <section>
            <h4>Follow Us</h4>
            <a href="#">Instagram</a>
            <a href="#">Facebook</a>
            <a href="#">YouTube</a>
          </section>
        </div>
        <p>© 2026 Gugan Fashions. All Rights Reserved.</p>
      </footer>
    </main>
  );
}

function AdminLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const session = readSession(ADMIN_KEY);
    if (session?.user.role === 'admin') navigate('/admin.com/dashboard', { replace: true });
  }, [navigate]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const validationError = validateCredentials(email, password);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError('');

    try {
      const data = await api<{ accessToken: string; user: AuthUser }>('/auth/admin/login', undefined, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (data.user.role !== 'admin') throw new Error('Unauthorized: admin account required.');
      writeSession(ADMIN_KEY, { token: data.accessToken, user: data.user });
      navigate('/admin.com/dashboard', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
      clearSession(ADMIN_KEY);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Gugan Fashions</h1>
        <p>Admin Access</p>

        <label htmlFor="admin-email">Email</label>
        <input id="admin-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="admin-password">Password</label>
        <input id="admin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />

        <button type="submit" disabled={busy}>{busy ? 'Signing in...' : 'Sign In'}</button>
        {error && <p className="flash flash-error">{error}</p>}
      </form>
    </main>
  );
}

function AdminDashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(() => readSession(ADMIN_KEY));
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [kpis, setKpis] = useState<any>(null);
  const [statusData, setStatusData] = useState<Array<{ status: string; count: number }>>([]);
  const [topProducts, setTopProducts] = useState<Array<{ name: string; quantity: number }>>([]);
  const [lowStock, setLowStock] = useState<Array<any>>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const [newProduct, setNewProduct] = useState({
    name: '',
    description: '',
    category: PRODUCT_CATEGORIES[0],
    brand: 'Gugan Fashions',
    image: '',
    basePrice: 1999,
    stockQuantity: 10,
    size: 'Free',
    color: 'Default',
    status: 'ACTIVE',
  });
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [discountForm, setDiscountForm] = useState<Record<string, { type: 'PERCENTAGE' | 'FIXED_AMOUNT'; value: number }>>({});

  useEffect(() => {
    if (!session?.token) {
      setLoading(false);
      return;
    }

    api<{ user: AuthUser }>('/auth/me', session.token)
      .then((res) => {
        if (res.user.role !== 'admin') throw new Error('Unauthorized');
      })
      .catch(() => {
        clearSession(ADMIN_KEY);
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, [session]);

  async function refreshDashboard() {
    if (!session?.token) return;
    const [a, b, c, d] = await Promise.all([
      api('/dashboard/kpis', session.token),
      api('/dashboard/orders-by-status', session.token),
      api('/dashboard/top-products', session.token),
      api<{ items: Array<any> }>('/dashboard/low-stock', session.token),
    ]);
    setKpis(a);
    setStatusData(b as Array<{ status: string; count: number }>);
    setTopProducts(c as Array<{ name: string; quantity: number }>);
    setLowStock(d.items);
  }

  async function refreshProducts() {
    if (!session?.token) return;
    const data = await api<{ data: Product[] }>('/products?page=1&pageSize=50', session.token);
    setProducts(data.data);
  }

  async function refreshOrders() {
    if (!session?.token) return;
    const data = await api<Order[]>('/orders', session.token);
    setOrders(data);
  }

  useEffect(() => {
    if (!session?.token || loading) return;
    Promise.all([refreshDashboard(), refreshProducts(), refreshOrders()]).catch((err: Error) => setMessage(err.message));
  }, [session?.token, loading]);

  const pendingOrders = useMemo(() => orders.filter((o) => o.status !== 'DELIVERED'), [orders]);

  function logout() {
    clearSession(ADMIN_KEY);
    setSession(null);
    navigate('/admin.com', { replace: true });
  }

  async function createProduct() {
    if (!session?.token) return;
    try {
      const payload = {
        ...newProduct,
        basePrice: Number(newProduct.basePrice),
        stockQuantity: Number(newProduct.stockQuantity),
      };
      if (editingProductId) {
        await api(`/products/${editingProductId}`, session.token, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setMessage('Product updated.');
      } else {
        await api('/products', session.token, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setMessage('Product created.');
      }
      await refreshProducts();
      setNewProduct({
        name: '',
        description: '',
        category: PRODUCT_CATEGORIES[0],
        brand: 'Gugan Fashions',
        image: '',
        basePrice: 1999,
        stockQuantity: 10,
        size: 'Free',
        color: 'Default',
        status: 'ACTIVE',
      });
      setEditingProductId(null);
    } catch (err: any) {
      setMessage(err.message);
    }
  }

  async function applyDiscount(product: Product) {
    if (!session?.token) return;
    const form = discountForm[product.id] || { type: 'PERCENTAGE', value: 10 };
    try {
      await api(`/products/${product.id}/discounts`, session.token, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      await refreshProducts();
      setMessage(`Discount applied to ${product.name}.`);
    } catch (err: any) {
      setMessage(err.message);
    }
  }

  function beginEditProduct(product: Product & any) {
    setEditingProductId(product.id);
    const firstVariant = product.variants?.[0];
    setNewProduct({
      name: product.name,
      description: product.description,
      category: product.category,
      brand: product.brand,
      image: product.images?.[0]?.url || '',
      basePrice: product.basePrice,
      stockQuantity: firstVariant?.stockQuantity ?? 0,
      size: firstVariant?.size ?? 'Free',
      color: firstVariant?.color ?? 'Default',
      status: product.status,
    });
  }

  async function deleteProduct(id: string) {
    if (!session?.token) return;
    try {
      await api(`/products/${id}`, session.token, { method: 'DELETE' });
      await refreshProducts();
      setConfirmDeleteId(null);
      if (editingProductId === id) {
        setEditingProductId(null);
      }
      setMessage('Product deleted.');
    } catch (err: any) {
      setMessage(err.message);
    }
  }

  async function updateOrderStatus(order: Order) {
    if (!session?.token) return;
    const idx = steps.indexOf(order.status);
    if (idx >= steps.length - 1) return;
    const next = steps[idx + 1];

    try {
      await api(`/orders/${order.id}/status`, session.token, {
        method: 'PATCH',
        body: JSON.stringify({ status: next, note: `Moved from ${order.status} to ${next}` }),
      });
      await refreshOrders();
      await refreshDashboard();
      setMessage(`Order ${order.orderNumber} moved to ${next}.`);
    } catch (err: any) {
      setMessage(err.message);
    }
  }

  if (loading) return <main className="auth-shell"><section className="auth-card"><p>Verifying admin session...</p></section></main>;
  if (!session || session.user.role !== 'admin') return <Navigate to="/admin.com" replace />;

  const showDashboard = location.pathname.endsWith('/dashboard');
  const showProducts = location.pathname.endsWith('/products');
  const showOrders = location.pathname.endsWith('/orders');

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>GF Admin</h2>
        <p>{session.user.name}</p>
        <p className="muted">admin</p>
        <nav>
          <button className={showDashboard ? 'active' : ''} onClick={() => navigate('/admin.com/dashboard')}>Dashboard</button>
          <button className={showProducts ? 'active' : ''} onClick={() => navigate('/admin.com/products')}>Products</button>
          <button className={showOrders ? 'active' : ''} onClick={() => navigate('/admin.com/orders')}>Orders</button>
        </nav>
        <button className="ghost" onClick={logout}>Logout</button>
      </aside>

      <main className="content">
        {message && <div className="flash">{message}</div>}

        {showDashboard && (
          <section className="grid">
            <div className="kpi"><h3>Orders Today</h3><p>{kpis?.totalOrdersToday ?? 0}</p></div>
            <div className="kpi"><h3>Orders Week</h3><p>{kpis?.totalOrdersWeek ?? 0}</p></div>
            <div className="kpi"><h3>Revenue</h3><p>{formatINR(kpis?.totalRevenue ?? 0)}</p></div>
            <div className="kpi"><h3>Pending</h3><p>{kpis?.pendingOrders ?? 0}</p></div>

            <article className="panel chart">
              <h3>Orders by Status</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={statusData} dataKey="count" nameKey="status" outerRadius={95} label>
                    {statusData.map((_, idx) => <Cell key={idx} fill={colors[idx % colors.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </article>

            <article className="panel">
              <h3>Top Products</h3>
              <ul>{topProducts.map((p) => <li key={p.name}><span>{p.name}</span><strong>{p.quantity}</strong></li>)}</ul>
            </article>

            <article className="panel">
              <h3>Low Stock (&lt; 10)</h3>
              <ul>{lowStock.map((item) => <li key={item.variantId}><span>{item.productName} ({item.size}/{item.color})</span><strong>{item.stockQuantity}</strong></li>)}</ul>
            </article>
          </section>
        )}

        {showProducts && (
          <section className="grid products">
            <article className="panel form">
              <h3>{editingProductId ? 'Edit Product' : 'Create Product'}</h3>
              <input placeholder="Name" value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} />
              <textarea placeholder="Description" value={newProduct.description} onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })} />
              <select value={newProduct.category} onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}>
                {PRODUCT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <input placeholder="Brand" value={newProduct.brand} onChange={(e) => setNewProduct({ ...newProduct, brand: e.target.value })} />
              <input placeholder="Image URL" value={newProduct.image} onChange={(e) => setNewProduct({ ...newProduct, image: e.target.value })} />
              <input type="number" value={newProduct.basePrice} onChange={(e) => setNewProduct({ ...newProduct, basePrice: Number(e.target.value) })} />
              <input type="number" value={newProduct.stockQuantity} onChange={(e) => setNewProduct({ ...newProduct, stockQuantity: Number(e.target.value) })} />
              <input placeholder="Size" value={newProduct.size} onChange={(e) => setNewProduct({ ...newProduct, size: e.target.value })} />
              <input placeholder="Color" value={newProduct.color} onChange={(e) => setNewProduct({ ...newProduct, color: e.target.value })} />
              <select value={newProduct.status} onChange={(e) => setNewProduct({ ...newProduct, status: e.target.value })}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="DRAFT">DRAFT</option>
                <option value="OUT_OF_STOCK">OUT OF STOCK</option>
              </select>
              <div className="inline" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button onClick={createProduct}>{editingProductId ? 'Save Changes' : 'Create'}</button>
                <button
                  className="ghost"
                  onClick={() => {
                    setEditingProductId(null);
                    setNewProduct({
                      name: '',
                      description: '',
                      category: PRODUCT_CATEGORIES[0],
                      brand: 'Gugan Fashions',
                      image: '',
                      basePrice: 1999,
                      stockQuantity: 10,
                      size: 'Free',
                      color: 'Default',
                      status: 'ACTIVE',
                    });
                  }}
                >
                  Reset
                </button>
              </div>
            </article>

            <article className="panel table-wrap">
              <h3>Catalog</h3>
              <table>
                <thead>
                  <tr><th>Product</th><th>Category</th><th>Price</th><th>Discount</th><th>Stock</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const stock = p.variants.reduce((sum, v) => sum + v.stockQuantity, 0);
                    const form = discountForm[p.id] || { type: 'PERCENTAGE', value: 10 };
                    return (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td>{p.category}</td>
                        <td><div>{formatINR(p.basePrice)}</div><strong>{formatINR(p.finalPrice)}</strong></td>
                        <td>
                          <div className="inline">
                            <select value={form.type} onChange={(e) => setDiscountForm({ ...discountForm, [p.id]: { ...form, type: e.target.value as 'PERCENTAGE' | 'FIXED_AMOUNT' } })}>
                              <option value="PERCENTAGE">%</option>
                              <option value="FIXED_AMOUNT">Flat</option>
                            </select>
                            <input type="number" value={form.value} onChange={(e) => setDiscountForm({ ...discountForm, [p.id]: { ...form, value: Number(e.target.value) } })} />
                            <button onClick={() => applyDiscount(p)}>Apply</button>
                          </div>
                        </td>
                        <td className={stock < 10 ? 'danger' : ''}>{stock}</td>
                        <td>
                          <div className="inline" style={{ gridTemplateColumns: '1fr 1fr' }}>
                            <button className="ghost" onClick={() => beginEditProduct(p as any)}>Edit</button>
                            <button className="ghost" onClick={() => setConfirmDeleteId(p.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {confirmDeleteId && (
                <div className="panel" style={{ marginTop: '0.8rem', borderColor: '#fecaca' }}>
                  <p>Are you sure you want to delete this product?</p>
                  <div className="inline" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <button className="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    <button onClick={() => deleteProduct(confirmDeleteId)}>Confirm Delete</button>
                  </div>
                </div>
              )}
            </article>
          </section>
        )}

        {showOrders && (
          <section className="grid">
            <article className="panel">
              <h3>Order Queue ({pendingOrders.length} pending)</h3>
              <table>
                <thead><tr><th>Order #</th><th>Customer</th><th>Status</th><th>Total</th><th>Action</th></tr></thead>
                <tbody>
                  {orders.map((order) => {
                    const idx = steps.indexOf(order.status);
                    const next = idx < steps.length - 1 ? steps[idx + 1] : null;
                    return (
                      <tr key={order.id}>
                        <td>{order.orderNumber}</td>
                        <td>{order.customerName}</td>
                        <td>{order.status}</td>
                        <td>{formatINR(order.totalAmount)}</td>
                        <td><button disabled={!next} onClick={() => updateOrderStatus(order)}>{next ? `Move to ${next}` : 'Completed'}</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </article>
          </section>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteMeta />
      <Routes>
        <Route path="/" element={<UserLoginPage />} />
        <Route path="/home" element={<UserHomePage />} />
        <Route path="/admin.com" element={<AdminLoginPage />} />
        <Route path="/admin.com/dashboard" element={<AdminDashboardPage />} />
        <Route path="/admin.com/products" element={<AdminDashboardPage />} />
        <Route path="/admin.com/orders" element={<AdminDashboardPage />} />
        <Route path="/admin.com/*" element={<Navigate to="/admin.com/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
