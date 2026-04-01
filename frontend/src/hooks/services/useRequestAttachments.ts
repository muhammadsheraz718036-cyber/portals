import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { services } from '../../services';
import { toast } from 'sonner';

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
      toast.success('Files uploaded successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to upload files');
    },
  });
};

export const useDownloadAttachment = () => {
  return useMutation({
    mutationFn: (attachmentId: string) => services.requestAttachments.downloadFile(attachmentId),
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to download file');
    },
  });
};

export const useDeleteRequestAttachment = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (attachmentId: string) => services.requestAttachments.deleteAttachment(attachmentId),
    onSuccess: (_, __) => {
      // We need to invalidate all request attachment queries since we don't have requestId here
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
      toast.success('Attachment deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete attachment');
    },
  });
};

export const useGetAttachmentDownloadUrl = () => {
  return (attachmentId: string) => services.requestAttachments.getDownloadUrl(attachmentId);
};
