import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';

export const useRequestAttachments = (requestId: string) => {
  return useQuery({
    queryKey: ['requests', requestId, 'attachments'],
    queryFn: () => services.requestAttachments.getAttachments(requestId),
    enabled: !!requestId,
  });
};

export const useUploadRequestAttachments = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ requestId, fieldName, files }: { 
      requestId: string; 
      fieldName: string; 
      files: File[] 
    }) => services.requestAttachments.uploadFiles(requestId, fieldName, files),
    onSuccess: (_, { requestId }) => {
      queryClient.invalidateQueries({ queryKey: ['requests', requestId, 'attachments'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-request', requestId] });
    },
  });
};

export const useDownloadAttachment = () => {
  return useMutation({
    mutationFn: (attachmentId: string) => services.requestAttachments.downloadFile(attachmentId),
  });
};

export const useDeleteRequestAttachment = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (attachmentId: string) => services.requestAttachments.deleteAttachment(attachmentId),
    onSuccess: (_, __) => {
      // We need to invalidate all request attachment queries since we don't have requestId here
      queryClient.invalidateQueries({ queryKey: ['requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
    },
  });
};

export const useGetAttachmentDownloadUrl = () => {
  return (attachmentId: string) => services.requestAttachments.getDownloadUrl(attachmentId);
};
