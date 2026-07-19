import { ROLE_TEMPLATES } from './permissions';

function rolePermissions(name: string) {
  return ROLE_TEMPLATES.find((role) => role.name === name)?.permissions ?? [];
}

describe('contract approval role templates', () => {
  it('separates approval stages by business role', () => {
    expect(rolePermissions('Sales')).toContain('contract:submit');
    expect(rolePermissions('Sales')).toContain('contract:convert-order');
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
        'contract:convert-order',
      ]),
    );
  });
});

describe('engineering document role templates', () => {
  it('separates design, review, and approval permissions', () => {
    expect(rolePermissions('EngineeringDesign')).toContain(
      'engineeringDocument:create',
    );
    expect(rolePermissions('EngineeringDesign')).not.toContain(
      'engineeringDocument:review',
    );
    expect(rolePermissions('EngineeringReview')).toContain(
      'engineeringDocument:review',
    );
    expect(rolePermissions('EngineeringReview')).not.toContain(
      'engineeringDocument:approve',
    );
    expect(rolePermissions('EngineeringApprover')).toContain(
      'engineeringDocument:approve',
    );
  });

  it('keeps readonly users out of engineering write actions', () => {
    expect(rolePermissions('Readonly')).not.toEqual(
      expect.arrayContaining([
        'engineeringDocument:create',
        'engineeringDocument:review',
        'engineeringDocument:approve',
      ]),
    );
  });
});
