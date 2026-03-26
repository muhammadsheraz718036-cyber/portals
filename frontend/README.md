# Approval Central - Frontend

A modern React application for managing approval requests with role-based access control, rich forms, and real-time status tracking.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment configuration
cp .env.example .env

# Start development server (port 5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Development Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint
- `npm run test` - Run Vitest
- `npm run test:watch` - Run tests in watch mode

## Key Features

- **User Authentication** - JWT-based login with role-based access
- **Approval Requests** - Create and manage approval workflows
- **Rich Forms** - Custom fields (text, number, date, select, radio, checkbox, textarea)
- **Rich Text Editor** - TipTap-based editor for detailed request content
- **Line Items** - Repeatable field groups for structured data
- **Request Tracking** - Real-time status updates and approval history
- **Admin Panel** - Manage users, roles, approval types, and chains
- **Audit Logs** - Comprehensive activity tracking

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **TailwindCSS** - Styling
- **shadcn/ui** - Component library
- **TipTap** - Rich text editor
- **React Router** - Navigation
- **Sonner** - Notifications

## Project Structure

```
src/
├── pages/              # Page components (routes)
├── components/         # Reusable components
│   ├── ui/            # shadcn/ui components
│   ├── admin/         # Admin panel components
│   └── ... other components
├── contexts/          # React Context (Auth, Company)
├── hooks/             # Custom hooks
├── lib/               # Utilities and API client
├── integrations/      # External services
└── test/              # Test files
```

## Environment Variables

### Development (`.env`)

```bash
# Optional: API URL (default: uses Vite proxy to http://localhost:4000)
VITE_API_URL=http://localhost:4000
```

For complete setup instructions, see the [root README.md](../README.md).

## Authentication

The application uses JWT tokens stored in localStorage. Authentication is handled automatically through the `AuthContext`:

```typescript
const { user, profile, isLoading } = useAuth();
```

## API Integration

API calls are made through the `api` client in `lib/api.ts`:

```typescript
import { api } from "@/lib/api";

// Example: fetch approval requests
const requests = await api.approvalRequests.list();

// Example: create new request
await api.approvalRequests.create({
  /* request data */
});
```

## Deployment

### Production Build

```bash
npm run build
```

This generates optimized files in the `dist/` directory.

### Deployment Options

1. **Static Hosting** (Vercel, Netlify, GitHub Pages)
   - Deploy the `dist/` folder
   - Configure API URL if not using relative paths

2. **Traditional Server** (Nginx, Apache)
   - Serve `dist/` folder
   - Enable gzip compression
   - Set up proper CORS headers

3. **Docker**
   ```dockerfile
   FROM node:20-alpine
   WORKDIR /app
   COPY . .
   RUN npm install && npm run build
   EXPOSE 3000
   CMD ["npm", "run", "preview"]
   ```

## Troubleshooting

**API calls fail in production**

- Ensure `VITE_API_URL` is set correctly
- Check CORS settings on backend

**Blank page after build**

- Clear browser cache
- Check console for errors
- Verify Node.js version (20+)

**Module not found errors**

- Run `npm install` again
- Delete `node_modules` and reinstall
- Clear npm cache: `npm cache clean --force`

## Code Quality

- **TypeScript** - Full type safety
- **ESLint** - Code linting
- **Prettier** - Code formatting (via ESLint)
- **Type-safe API** - Zod validation on backend

## Performance

- Code splitting via Vite
- Tree shaking of unused code
- Optimized component rendering
- Lazy-loaded routes

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Requires modern JavaScript (ES2020+)

For more information, see the [root README.md](../README.md).
