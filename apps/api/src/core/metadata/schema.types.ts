export type UiFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'select'
  | 'text'
  | 'reference'
  | 'subtable';

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

export interface UiSubtableConfig {
  fields: UiFieldSchema[];
  minRows?: number;
  maxRows?: number;
}

export interface UiFieldSchema {
  name: string;
  label: string;
  type: UiFieldType;
  required?: boolean;
  custom?: boolean;
  options?: UiFieldOption[];
  reference?: UiFieldReference;
  subtable?: UiSubtableConfig;
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
}

export interface UiAction {
  name: string;
  label: string;
  icon?: string;
  style?: 'primary' | 'danger' | 'default';
  endpoint: string;
  method?: 'POST' | 'PUT' | 'DELETE';
  visibility?: string;
  requiresPermission?: string[];
  prompt?: string;
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
  actions?: UiAction[];
}
