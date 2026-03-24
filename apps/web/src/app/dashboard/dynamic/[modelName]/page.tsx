import { DynamicView } from '@/components/core/DynamicView';

interface DynamicModelPageProps {
  params: Promise<{ modelName: string }>;
}

export default async function DynamicModelPage({ params }: DynamicModelPageProps) {
  const { modelName } = await params;

  return <DynamicView modelName={modelName} />;
}
