import React from 'react';
import {
  ExplorerPage,
  ExplorerPageGetServerSideProps as getServerSideProps,
} from '@gen3/frontend';
import { useMemo } from 'react';
import { useRouter } from 'next/router';

import { registerCohortTableCustomCellRenderers } from '@/lib/CohortBuilder/CustomCellRenderers';
import { registerCustomExplorerDetailsPanels } from '@/lib/CohortBuilder/FileDetailsPanel';
import ExportToJupyterButton from '@/components/ExportToJupyterButton';

registerCohortTableCustomCellRenderers();
registerCustomExplorerDetailsPanels();

const ExplorerWithJupyterExport = (
  props: React.ComponentProps<typeof ExplorerPage>,
) => {
  const router = useRouter();

  const exportPayload = useMemo(() => {
    const cohortIdRaw =
      router.query.cohortId || router.query.cohort_id || router.query.cohort;

    const cohortNameRaw =
      router.query.cohortName || router.query.cohort_name || router.query.name;

    const cohortId =
      typeof cohortIdRaw === 'string'
        ? cohortIdRaw
        : Array.isArray(cohortIdRaw)
          ? cohortIdRaw[0]
          : undefined;

    const cohortName =
      typeof cohortNameRaw === 'string'
        ? cohortNameRaw
        : Array.isArray(cohortNameRaw)
          ? cohortNameRaw[0]
          : undefined;

    return {
      exportSource: 'cohort' as const,
      cohortId,
      cohortName,
      metadata: {
        route: router.asPath,
      },
    };
  }, [router.asPath, router.query]);

  return (
    <div className="relative">
      <div className="fixed bottom-6 right-6 z-50">
        <ExportToJupyterButton
          label="Export Cohort to Jupyter"
          payload={exportPayload}
        />
      </div>
      <ExplorerPage {...props} />
    </div>
  );
};

export default ExplorerWithJupyterExport;

export { getServerSideProps };
