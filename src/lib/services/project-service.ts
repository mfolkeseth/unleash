import User from '../user';
import { AccessService } from './access-service';
import { isFeatureEnabled, FEATURES } from '../util/feature-enabled';

const NameExistsError = require('../error/name-exists-error');
const InvalidOperationError = require('../error/invalid-operation-error');
const eventType = require('../event-type');
const { nameType } = require('../routes/admin-api/util');
const schema = require('./project-schema');
const NotFoundError = require('../error/notfound-error');

interface Project {
    id: string;
    name: string;
    description?: string;
}

const getCreatedBy = (user: User) => user.email || user.username;

class ProjectService {
    private projectStore: any;

    private accessService: AccessService;

    private eventStore: any;

    private featureToggleStore: any;

    private logger: any;

    private rbacEnabled: boolean;

    constructor(
        { projectStore, eventStore, featureToggleStore },
        config: any,
        accessService: AccessService,
    ) {
        this.projectStore = projectStore;
        this.accessService = accessService;
        this.eventStore = eventStore;
        this.featureToggleStore = featureToggleStore;
        this.logger = config.getLogger('services/project-service.js');
        this.rbacEnabled = isFeatureEnabled(config, FEATURES.RBAC);
    }

    async getProjects() {
        return this.projectStore.getAll();
    }

    async getProject(id) {
        return this.projectStore.get(id);
    }

    async createProject(newProject: Project, user: User): Promise<Project> {
        const data = await schema.validateAsync(newProject);
        await this.validateUniqueId(data.id);

        await this.projectStore.create(data);

        if (this.rbacEnabled) {
            await this.accessService.createDefaultProjectRoles(user, data.id);
        }

        await this.eventStore.store({
            type: eventType.PROJECT_CREATED,
            createdBy: getCreatedBy(user),
            data,
        });

        return data;
    }

    async updateProject(updatedProject: Project, user: User): Promise<void> {
        await this.projectStore.get(updatedProject.id);
        const project = await schema.validateAsync(updatedProject);

        await this.projectStore.update(project);

        await this.eventStore.store({
            type: eventType.PROJECT_UPDATED,
            createdBy: getCreatedBy(user),
            data: project,
        });
    }

    async deleteProject(id: string, user: User): Promise<void> {
        if (id === 'default') {
            throw new InvalidOperationError(
                'You can not delete the default project!',
            );
        }

        const toggles = await this.featureToggleStore.getFeaturesBy({
            project: id,
            archived: 0,
        });

        if (toggles.length > 0) {
            throw new InvalidOperationError(
                'You can not delete as project with active feature toggles',
            );
        }

        await this.projectStore.delete(id);

        await this.eventStore.store({
            type: eventType.PROJECT_DELETED,
            createdBy: getCreatedBy(user),
            data: { id },
        });

        if (this.rbacEnabled) {
            this.accessService.removeDefaultProjectRoles(user, id);
        }
    }

    async validateId(id: string): Promise<boolean> {
        await nameType.validateAsync(id);
        await this.validateUniqueId(id);
        return true;
    }

    async validateUniqueId(id: string): Promise<void> {
        try {
            await this.projectStore.hasProject(id);
        } catch (error) {
            // No conflict, everything ok!
            return;
        }

        // Intentional throw here!
        throw new NameExistsError('A project with this id already exists.');
    }

    // RBAC methods
    async getUsersWithAccess(projectId: string, user: User) {
        let [roles, users] = await this.accessService.getProjectRoleUsers(
            projectId,
        );
        if (roles.length === 0) {
            // TODO: ONLY if RBAC is enabled.
            this.logger.warn(`Creating missing roles for project ${projectId}`);
            await this.accessService.createDefaultProjectRoles(user, projectId);
            [roles, users] = await this.accessService.getProjectRoleUsers(
                projectId,
            );
        }
        return {
            roles,
            users,
        };
    }

    async addUser(
        projectId: string,
        roleId: number,
        userId: number,
    ): Promise<void> {
        const [roles, users] = await this.accessService.getProjectRoleUsers(
            projectId,
        );

        const role = roles.find(r => r.id === roleId);
        if (!role) {
            throw new NotFoundError(
                `Could not find roleId=${roleId} on project=${projectId}`,
            );
        }

        const alreadyHasAccess = users.some(u => u.id === userId);
        if (alreadyHasAccess) {
            throw new Error(`User already have access to project=${projectId}`);
        }

        await this.accessService.addUserToRole(userId, role.id);
    }

    async removeUser(
        projectId: string,
        roleId: number,
        userId: number,
    ): Promise<void> {
        const roles = await this.accessService.getRolesForProject(projectId);
        const role = roles.find(r => r.id === roleId);
        if (!role) {
            throw new NotFoundError(
                `Couldn't find roleId=${roleId} on project=${projectId}`,
            );
        }

        if (role.type === 'project-admin') {
            const users = await this.accessService.getUsersForRole(role.id);
            if (users.length < 2) {
                throw new Error('A project must have at least one admin');
            }
        }

        await this.accessService.removeUserFromRole(userId, role.id);
    }
}

module.exports = ProjectService;