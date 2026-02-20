import React from 'react';
import {
  DataLibraryPage,
  DataLibraryPageGetServerSideProps as getServerSideProps,
} from '@gen3/frontend';
import { useMemo } from 'react';
import { useRouter } from 'next/router';
import ExportToJupyterButton from '@/components/ExportToJupyterButton';

const asStringArray = (value: string | string[] | undefined) => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.filter((item) => Boolean(item));
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

const DataLibraryWithJupyterExport = (
  props: React.ComponentProps<typeof DataLibraryPage>,
) => {
  const router = useRouter();

  const exportPayload = useMemo(() => {
    const dataLibraryIds = asStringArray(
      (router.query.dataLibraryIds as string | string[] | undefined) ||
        (router.query.ids as string | string[] | undefined),
    );

    return {
      exportSource: 'data-library' as const,
      dataLibraryIds,
      metadata: {
        route: router.asPath,
        includeCurrentLibraryContext: true,
      },
    };
  }, [router.asPath, router.query]);

  return (
    <div className="relative">
      <div className="fixed bottom-6 right-6 z-50">
        <ExportToJupyterButton
          label="Export Data Library to Jupyter"
          payload={exportPayload}
        />
      </div>
      <DataLibraryPage {...props} />
    </div>
  );
};

export default DataLibraryWithJupyterExport;

export { getServerSideProps };
