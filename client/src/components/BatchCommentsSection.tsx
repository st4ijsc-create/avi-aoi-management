/**
 * BatchCommentsSection - Component hiển thị nhận xét và gắn thẻ cho training batch
 */
import { useState } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { 
  MessageSquare, 
  Tag, 
  Plus, 
  Send, 
  Trash2, 
  Edit2, 
  Check, 
  X,
  MoreHorizontal,
  Reply
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";

interface BatchCommentsSectionProps {
  batchId: string;
  batchName?: string;
}

export function BatchCommentsSection({ batchId, batchName }: BatchCommentsSectionProps) {
  const { t } = useTranslation();
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);

  const utils = trpc.useUtils();

  // Queries
  const { data: comments, isLoading: commentsLoading } = trpc.trainingBatchComments.listComments.useQuery({
    batchId,
    limit: 50,
  });

  const { data: batchTags, isLoading: tagsLoading } = trpc.trainingBatchComments.getBatchTags.useQuery({
    batchId,
  });

  const { data: allTags } = trpc.trainingBatchComments.listTags.useQuery();

  // Mutations
  const addCommentMutation = trpc.trainingBatchComments.addComment.useMutation({
    onSuccess: () => {
      setNewComment("");
      utils.trainingBatchComments.listComments.invalidate({ batchId });
      toast.success(t('annotation.comments.added'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const updateCommentMutation = trpc.trainingBatchComments.updateComment.useMutation({
    onSuccess: () => {
      setEditingCommentId(null);
      setEditContent("");
      utils.trainingBatchComments.listComments.invalidate({ batchId });
      toast.success(t('annotation.comments.updated'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const deleteCommentMutation = trpc.trainingBatchComments.deleteComment.useMutation({
    onSuccess: () => {
      utils.trainingBatchComments.listComments.invalidate({ batchId });
      toast.success(t('annotation.comments.deleted'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const createTagMutation = trpc.trainingBatchComments.createTag.useMutation({
    onSuccess: () => {
      setNewTagName("");
      setNewTagColor("#3b82f6");
      setIsTagDialogOpen(false);
      utils.trainingBatchComments.listTags.invalidate();
      toast.success(t('annotation.tags.created'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const assignTagMutation = trpc.trainingBatchComments.assignTag.useMutation({
    onSuccess: () => {
      utils.trainingBatchComments.getBatchTags.invalidate({ batchId });
      setTagPopoverOpen(false);
      toast.success(t('annotation.tags.assigned'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const removeTagMutation = trpc.trainingBatchComments.removeTag.useMutation({
    onSuccess: () => {
      utils.trainingBatchComments.getBatchTags.invalidate({ batchId });
      toast.success(t('annotation.tags.removed'));
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    addCommentMutation.mutate({
      batchId,
      content: newComment.trim(),
    });
  };

  const handleUpdateComment = (commentId: number) => {
    if (!editContent.trim()) return;
    updateCommentMutation.mutate({
      commentId,
      content: editContent.trim(),
    });
  };

  const handleDeleteComment = (commentId: number) => {
    if (confirm(t('annotation.comments.confirmDelete'))) {
      deleteCommentMutation.mutate({ commentId });
    }
  };

  const handleCreateTag = () => {
    if (!newTagName.trim()) return;
    createTagMutation.mutate({
      name: newTagName.trim(),
      color: newTagColor,
    });
  };

  const handleAssignTag = (tagId: number) => {
    assignTagMutation.mutate({ batchId, tagId });
  };

  const handleRemoveTag = (tagId: number) => {
    removeTagMutation.mutate({ batchId, tagId });
  };

  const availableTags = allTags?.filter(
    tag => !batchTags?.some(bt => bt.id === tag.id)
  ) || [];

  const colorOptions = [
    "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
    "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
  ];

  return (
    <div className="space-y-4">
      {/* Tags Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Tag className="h-4 w-4" />
            {t('annotation.tags.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 items-center">
            {tagsLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : batchTags && batchTags.length > 0 ? (
              batchTags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="secondary"
                  style={{ backgroundColor: `${tag.color}20`, borderColor: tag.color, color: tag.color }}
                  className="border flex items-center gap-1 pr-1"
                >
                  {tag.name}
                  <button
                    onClick={() => handleRemoveTag(tag.id)}
                    className="ml-1 hover:bg-black/10 rounded p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))
            ) : (
              <span className="text-sm text-muted-foreground">{t('annotation.tags.noTags')}</span>
            )}

            {/* Add Tag Popover */}
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 px-2">
                  <Plus className="h-3 w-3 mr-1" />
                  {t('annotation.tags.addTag')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <Command>
                  <CommandInput placeholder={t('annotation.tags.searchTags')} />
                  <CommandList>
                    <CommandEmpty>
                      <div className="p-2 text-center">
                        <p className="text-sm text-muted-foreground mb-2">{t('annotation.tags.notFound')}</p>
                        <Dialog open={isTagDialogOpen} onOpenChange={setIsTagDialogOpen}>
                          <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                              <Plus className="h-3 w-3 mr-1" />
                              {t('annotation.tags.createNew')}
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>{t('annotation.tags.createNew')}</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div>
                                <label className="text-sm font-medium">{t('annotation.tags.tagName')}</label>
                                <Input
                                  value={newTagName}
                                  onChange={(e) => setNewTagName(e.target.value)}
                                  placeholder={t('annotation.tags.enterTagName')}
                                />
                              </div>
                              <div>
                                <label className="text-sm font-medium">{t('annotation.tags.color')}</label>
                                <div className="flex gap-2 mt-2">
                                  {colorOptions.map((color) => (
                                    <button
                                      key={color}
                                      onClick={() => setNewTagColor(color)}
                                      className={`w-6 h-6 rounded-full border-2 ${
                                        newTagColor === color ? "border-black" : "border-transparent"
                                      }`}
                                      style={{ backgroundColor: color }}
                                    />
                                  ))}
                                </div>
                              </div>
                            </div>
                            <DialogFooter>
                              <Button
                                onClick={handleCreateTag}
                                disabled={!newTagName.trim() || createTagMutation.isPending}
                              >
                                {createTagMutation.isPending ? t('annotation.tags.creating') : t('annotation.tags.createTag')}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </CommandEmpty>
                    <CommandGroup>
                      {availableTags.map((tag) => (
                        <CommandItem
                          key={tag.id}
                          onSelect={() => handleAssignTag(tag.id)}
                          className="cursor-pointer"
                        >
                          <div
                            className="w-3 h-3 rounded-full mr-2"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </CardContent>
      </Card>

      {/* Comments Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            {t('annotation.comments.title')} ({comments?.total || 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add Comment Form */}
          <div className="flex gap-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={t('annotation.comments.addComment')}
              className="min-h-[60px] resize-none"
            />
            <Button
              onClick={handleAddComment}
              disabled={!newComment.trim() || addCommentMutation.isPending}
              size="icon"
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>

          {/* Comments List */}
          <ScrollArea className="max-h-[400px]">
            {commentsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : comments?.comments && comments.comments.length > 0 ? (
              <div className="space-y-3">
                {comments.comments.map((comment) => (
                  <div
                    key={comment.id}
                    className="p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">
                            {comment.userName || t('annotation.comments.anonymous')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(comment.createdAt), {
                              addSuffix: true,
                              locale: vi,
                            })}
                          </span>
                          {comment.updatedAt > comment.createdAt && (
                            <span className="text-xs text-muted-foreground">({t('annotation.comments.edited')})</span>
                          )}
                        </div>
                        
                        {editingCommentId === comment.id ? (
                          <div className="flex gap-2 mt-2">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="min-h-[60px] resize-none"
                            />
                            <div className="flex flex-col gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleUpdateComment(comment.id)}
                                disabled={updateCommentMutation.isPending}
                              >
                                <Check className="h-4 w-4 text-green-500" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setEditingCommentId(null);
                                  setEditContent("");
                                }}
                              >
                                <X className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                        )}
                      </div>

                      {editingCommentId !== comment.id && (
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => {
                              setEditingCommentId(comment.id);
                              setEditContent(comment.content);
                            }}
                          >
                            <Edit2 className="h-3 w-3" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-red-500 hover:text-red-600"
                            onClick={() => handleDeleteComment(comment.id)}
                            disabled={deleteCommentMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{t('annotation.comments.noComments')}</p>
                <p className="text-xs">{t('annotation.comments.beFirst')}</p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

export default BatchCommentsSection;
