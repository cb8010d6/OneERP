import { ROLE_TEMPLATES } from './permissions';

function rolePermissions(name: string) {
  return ROLE_TEMPLATES.find((role) => role.name === name)?.permissions ?? [];
}

describe('contract approval role templates', () => {
  it('separates approval stages by business role', () => {
    expect(rolePermissions('Sales')).toContain('contract:submit');
    expect(rolePermissions('Sales')).not.toContain('contract:approve-sales');
    expect(rolePermissions('SalesManager')).toContain('contract:approve-sales');
    expect(rolePermissions('SalesManager')).toEqual(
      expect.arrayContaining(['contract:sign', 'contract:activate']),
    );
    expect(rolePermissions('Finance')).toContain('contract:review-finance');
    expect(rolePermissions('BusinessReview')).toContain(
      'contract:review-business',
    );
  });

  it('does not grant contract approval to readonly users', () => {
    expect(rolePermissions('Readonly')).not.toEqual(
      expect.arrayContaining([
        'contract:submit',
        'contract:approve-sales',
        'contract:review-finance',
        'contract:review-business',
      ]),
    );
  });
});
