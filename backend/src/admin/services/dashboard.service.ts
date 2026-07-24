import { dataRepository } from "../repositories/data.repository";
import { reportRepository } from "../repositories/report.repository";
import { logRepository } from "../repositories/log.repository";

export const dashboardService = {
  async getStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const since = today.toISOString();

    const [
      totalUsers,
      activeUsers,
      newUsersToday,
      postsCount,
      friendshipsCount,
      commentsCount,
      reactionsCount,
      notificationsCount,
      openReports,
      registrationsChart,
      postsChart,
      latestRegistrations,
      latestActivities,
    ] = await Promise.all([
      dataRepository.countProfiles(),
      dataRepository.countProfiles({ status: "active" }),
      dataRepository.countProfiles({ since }),
      dataRepository.countPosts(),
      dataRepository.countFriendships("accepted"),
      dataRepository.countComments(),
      dataRepository.countReactions(),
      dataRepository.countNotifications(),
      reportRepository.list({ status: "open", limit: 1, offset: 0 }).then((r) => r.total),
      dataRepository.registrationsByDay(13),
      dataRepository.postsByDay(13),
      dataRepository.latestProfiles(8),
      logRepository.list({ limit: 12, offset: 0 }),
    ]);

    return {
      cards: {
        totalUsers,
        activeUsers,
        newUsersToday,
        postsCount,
        friendshipsCount,
        commentsCount,
        reactionsCount,
        notificationsCount,
        reportsCount: openReports,
      },
      charts: {
        registrations: registrationsChart,
        posts: postsChart,
      },
      latestRegistrations,
      latestActivities: latestActivities.items,
    };
  },
};
