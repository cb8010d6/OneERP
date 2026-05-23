export type UiFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'text'
  | 'reference';

export interface UiFieldOption {
  label: string;
  value: string | number | boolean;
}

export interface UiFieldReference {
  model: string;
  labelField?: string;
  valueField?: string;
  relationField?: string;
}

export interface UiFieldSchema {
  name: string;
  label: string;
  type: UiFieldType;
  required?: boolean;
  custom?: boolean;
  options?: UiFieldOption[];
  reference?: UiFieldReference;
  depends_on?: string; // e.g. "eval:doc.status=='Draft'"
  hidden_depends_on?: string;
  read_only_depends_on?: string;
}

export interface UiFormSection {
  title?: string;
  fields: string[];
}

export interface UiFormView {
  fields?: string[];
  sections?: UiFormSection[];
}

export interface UiListView {
  columns: string[];
  defaultSort?: Record<string, 'asc' | 'desc'>;
  searchFields?: string[];
}

export interface UiKanbanColumn {
  value: string;
  label: string;
  color?: string;
}

export interface UiKanbanView {
  statusField: string;
  columns: UiKanbanColumn[];
  transitionForms?: Record<string, Array<{ name: string; label: string; placeholder?: string }>>;
}

export type UiActionTone = 'primary' | 'secondary' | 'info' | 'danger';
export type UiActionKind = 'api' | 'correction';
export type UiActionMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface UiActionField {
  name: string;
  label: string;
  type: 'string' | 'text' | 'reference';
  required?: boolean;
  placeholder?: string;
  reference?: UiFieldReference;
}

export interface UiActionSchema {
  name: string;
  label: string;
  kind: UiActionKind;
  tone?: UiActionTone;
  method: UiActionMethod;
  endpoint: string;
  permission?: string;
  visibleWhen?: string;
  confirmText?: string;
  description?: string;
  successMessage?: string;
  fields?: UiActionField[];
}

export interface UiSchema {
  model: string;
  label: string;
  companyScoped?: boolean;
  description?: string;
  fields: UiFieldSchema[];
  views: {
    form: UiFormView;
    list: UiListView;
    kanban?: UiKanbanView;
  };
  actions?: UiActionSchema[];
}
