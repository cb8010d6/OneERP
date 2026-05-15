import api from './api';
import type { UiSchema } from './ui-schema';

export interface ResourceListResponse<T = Record<string, unknown>> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ListParams {
  page?: number;
  limit?: number;
  search?: string;
  searchFields?: string[];
  filter?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  include?: Record<string, unknown>;
}

export type CustomFieldType = 'STRING' | 'NUMBER' | 'REF';

export interface CustomFieldDefinition {
  id: string;
  modelName: string;
  fieldName: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  referenceModel?: string | null;
  referenceLabelField?: string | null;
  referenceValueField?: string | null;
  referenceRelationField?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCustomFieldPayload {
  fieldName: string;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  referenceModel?: string;
  referenceLabelField?: string;
  referenceValueField?: string;
  referenceRelationField?: string;
}

export async function fetchSchema(modelName: string) {
  const response = await api.get<UiSchema>(`/v1/metadata/${modelName}`);
  return response.data;
}

export async function fetchResourceList(modelName: string, params: ListParams) {
  const query = new URLSearchParams();
  query.set('page', String(params.page ?? 1));
  query.set('limit', String(params.limit ?? 20));

  if (params.search) {
    query.set('search', params.search);
  }

  if (params.searchFields?.length) {
    query.set('searchFields', params.searchFields.join(','));
  }

  if (params.filter) {
    query.set('filter', JSON.stringify(params.filter));
  }

  if (params.orderBy) {
    query.set('orderBy', JSON.stringify(params.orderBy));
  }

  if (params.include) {
    query.set('include', JSON.stringify(params.include));
  }

  const response = await api.get<ResourceListResponse>(`/v1/resource/${modelName}?${query.toString()}`);
  return response.data;
}

export async function createResource(modelName: string, payload: Record<string, unknown>) {
  const response = await api.post<Record<string, unknown>>(`/v1/resource/${modelName}`, payload);
  return response.data;
}

export async function updateResource(modelName: string, id: string, payload: Record<string, unknown>) {
  const response = await api.put<Record<string, unknown>>(`/v1/resource/${modelName}/${id}`, payload);
  return response.data;
}

export async function fetchCustomFields(modelName: string) {
  const response = await api.get<CustomFieldDefinition[]>(`/v1/metadata/${modelName}/custom-fields`);
  return response.data;
}

export async function upsertCustomField(modelName: string, payload: UpsertCustomFieldPayload) {
  const response = await api.post<CustomFieldDefinition>(`/v1/metadata/${modelName}/custom-fields`, payload);
  return response.data;
}

export async function removeCustomField(modelName: string, fieldName: string) {
  await api.delete(`/v1/metadata/${modelName}/custom-fields/${fieldName}`);
}
