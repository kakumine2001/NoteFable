-- AI proposal thumbnails (#158) move out of NoteProposal.payload into the private file store, like every other image.
-- Additive: a new kind of stored file. Proposals written before keep no thumbnails (only the test adapter made them).

-- AlterEnum
ALTER TYPE "StoredFileKind" ADD VALUE 'PROPOSAL_IMAGE';
