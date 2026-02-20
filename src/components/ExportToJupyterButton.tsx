import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@mantine/core';

type ExportSource = 'cohort' | 'data-library' | 'mixed';

type ExportPayload = {
  cohortId?: string;
  cohortName?: string;
  dataLibraryIds?: string[];
  guids?: string[];
  exportSource: ExportSource;
  metadata?: Record<string, unknown>;
};

type Props = {
  label?: string;
  payload: ExportPayload;
  className?: string;
};

const ExportToJupyterButton = ({
  label = 'Export to Jupyter',
  payload,
  className,
}: Props) => {
  const [isJegEnabled, setIsJegEnabled] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let mounted = true;

    const checkJegEnabled = async () => {
      setIsChecking(true);
      try {
        const response = await fetch('/api/workspace/jeg/enabled', {
          method: 'GET',
          credentials: 'include',
        });

        if (!mounted) return;

        if (!response.ok) {
          setIsJegEnabled(false);
          return;
        }

        const body = (await response.json()) as { enabled?: boolean };
        setIsJegEnabled(Boolean(body.enabled));
      } catch {
        if (!mounted) return;
        setIsJegEnabled(false);
      } finally {
        if (mounted) {
          setIsChecking(false);
        }
      }
    };

    checkJegEnabled();

    return () => {
      mounted = false;
    };
  }, []);

  const disabled = useMemo(
    () => isChecking || isExporting,
    [isChecking, isExporting],
  );

  const handleExport = async () => {
    if (!isJegEnabled) return;
    setIsExporting(true);

    try {
      const response = await fetch('/api/workspace/jeg/export', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        setIsExporting(false);
        return;
      }

      const body = (await response.json()) as { launchUrl?: string };
      window.location.assign(body.launchUrl || '/Workspace/JEG?context=1');
    } catch {
      setIsExporting(false);
    }
  };

  if (!isJegEnabled) return null;

  return (
    <Button
      className={className}
      color="accent.5"
      variant="outline"
      onClick={handleExport}
      loading={disabled}
    >
      {label}
    </Button>
  );
};

export default ExportToJupyterButton;
