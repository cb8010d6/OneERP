import { test as base, expect } from '@playwright/test';

const companies = ['a', 'b'].map((suffix) => ({
  id: `synthetic-${suffix}`,
  name: `Synthetic Company ${suffix.toUpperCase()}`,
  role: 'Synthetic UI Tester',
  permissions: ['ALL'],
}));
const schema = {
  model: 'partner', label: 'Synthetic Customers', allowGenericWrite: false,
  fields: [
    { name: 'id', label: 'ID', type: 'string' },
    { name: 'name', label: 'Customer', type: 'string' },
  ],
  views: {
    form: { fields: ['name'] },
    list: { columns: ['id', 'name'], searchFields: ['name'] },
  },
};

export const test = base.extend({
  page: async ({ page }, use) => {
    const unexpected = [];
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(({ companies }) => {
      // Deliberately unsigned, synthetic JWT-shaped value; never accepted by a real API.
      localStorage.setItem('token', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.synthetic');
      localStorage.setItem('user', JSON.stringify({ id: 'synthetic-user', name: 'Synthetic UI Tester' }));
      localStorage.setItem('companies', JSON.stringify(companies));
      localStorage.setItem('currentCompanyId', companies[0].id);
      localStorage.setItem('oneerp.language', 'zh-CN');
    }, { companies });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const isLocal = url.origin === 'http://127.0.0.1:3100';
      if (isLocal && !url.pathname.startsWith('/api/')) return route.continue();
      const companyId = request.headers()['x-company-id'];
      const isSyntheticCompany = companies.some((company) => company.id === companyId);
      if (isLocal && request.method() === 'GET' && isSyntheticCompany) {
        const path = url.pathname.replace(/^\/api\/proxy/, '');
        if (path === '/users/permissions/me') {
          return route.fulfill({ json: { permissions: ['ALL'], role: { id: 'synthetic-role', name: 'Synthetic UI Tester' } } });
        }
        if (path === '/v1/metadata/partner') return route.fulfill({ json: schema });
        if (path === '/v1/resource/partner') {
          return route.fulfill({ json: {
            data: [{ id: 'synthetic-partner', name: `Customer of ${companyId}` }],
            total: 1, page: 1, limit: 20, totalPages: 1,
          } });
        }
        if (path === '/v1/timeline/partner/synthetic-partner') {
          return route.fulfill({ json: { events: [] } });
        }
      }
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    });
    await use(page);
    expect(unexpected, 'All API calls must have explicit synthetic fixtures; external traffic and writes are forbidden').toEqual([]);
    expect(pageErrors, 'No uncaught browser exceptions').toEqual([]);
  },
});
export { expect };
