import * as React from 'react';
import Dialog, { DialogProps } from '@mui/material/Dialog';
import Slide from '@mui/material/Slide';
import { TransitionProps } from '@mui/material/transitions';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

const SlideUp = React.forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement<any, any> },
  ref: React.Ref<unknown>,
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

/**
 * MUI Dialog that renders as a centered modal on desktop and an anchored,
 * slide-up bottom sheet on mobile (audit item: "Modals → drawers on mobile").
 * Drop-in replacement for <Dialog> - forwards all props.
 */
export default function ResponsiveDialog({
  PaperProps,
  TransitionComponent,
  fullWidth,
  ...props
}: DialogProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (!isMobile) {
    return (
      <Dialog
        {...props}
        fullWidth={fullWidth}
        PaperProps={PaperProps}
        TransitionComponent={TransitionComponent}
      />
    );
  }

  return (
    <Dialog
      {...props}
      fullWidth
      TransitionComponent={TransitionComponent || SlideUp}
      PaperProps={{
        ...PaperProps,
        sx: {
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          m: 0,
          width: '100%',
          maxWidth: '100%',
          borderRadius: '20px 20px 0 0',
          maxHeight: '92vh',
          ...(PaperProps?.sx as object),
        },
      }}
    />
  );
}
