import React from 'react';

type ActiveMount = {
  id: string;
  displayName: string;
  s3Uri: string;
};

type Props = {
  launchMode: 'personal' | 'pre-release';
  mounts: ActiveMount[];
};

const ActiveMountsStatusBar = ({ launchMode, mounts }: Props) => {
  const isPersonalMode = launchMode === 'personal';
  const hasMounts = mounts.length > 0;

  return (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex items-center gap-2 font-semibold">
        {isPersonalMode ? (
          <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 8a3 3 0 100-6 3 3 0 000 6zM3.465 14.493a1.23 1.23 0 00.41 1.412A9.957 9.957 0 0010 18c2.31 0 4.438-.784 6.131-2.095a1.23 1.23 0 00.41-1.412A9.995 9.995 0 0010 12c-2.31 0-4.438.784-6.131 2.095z" />
          </svg>
        ) : (
          <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 12.5a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5a.75.75 0 01.75-.75z" />
            <path fillRule="evenodd" d="M3.013 4.1a.75.75 0 01.876-.217l3.582 1.268a.75.75 0 01.44 1.232l-1.017 2.85a.75.75 0 01-1.232-.44l.56-1.573-2.018-.714a.75.75 0 01-.217-.876l-.002-.003zm13.974 0a.75.75 0 01.217.876l-3.582 1.268a.75.75 0 01-1.232-.44l1.017-2.85a.75.75 0 011.232.44l-.56 1.573 2.018.714a.75.75 0 01.876.217l.002.003zM7.5 10a.75.75 0 01.75-.75h4a.75.75 0 010 1.5h-4a.75.75 0 01-.75-.75z" clipRule="evenodd" />
          </svg>
        )}
        <span className="text-slate-700">{isPersonalMode ? 'Personal Mode' : 'Team Mode'}</span>
      </div>
      <div className="h-4 w-px bg-slate-200" />
      <div className="text-slate-600">
        {isPersonalMode ? (
          'No shared data attached.'
        ) : hasMounts ? (
          <div className="flex items-center gap-2">
            <span>{mounts.length} shared data source(s) attached:</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {mounts.map((mount) => (
                <span
                  key={mount.id}
                  className="rounded-full bg-blue-100 px-2.5 py-0.5 font-medium text-blue-800"
                  title={mount.s3Uri}
                >
                  {mount.displayName}
                </span>
              ))}
            </div>
          </div>
        ) : (
          'No shared data attached for this session.'
        )}
      </div>
    </div>
  );
};

export default ActiveMountsStatusBar;
